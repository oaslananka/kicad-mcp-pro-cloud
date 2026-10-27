import assert from "node:assert/strict";
import { createServer as httpCreateServer, request as httpRequest, type Server } from "node:http";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createHttpServer } from "../src/http.js";
import type { Config } from "../src/config.js";
import type { Inventory, Device, Project } from "../src/store.js";
import type { Actor, Verifier } from "../src/auth.js";
import type { GrantManagement } from "../src/grants.js";

const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const mockProject: Project = {
  id, alias: "USB-C Controller", deviceId: "d108b5f4-22f2-4b3c-b62d-55163fa34814",
  enabled: true, maxMode: "readonly", available: false,
  reason: "remote_connector_not_implemented"
};
let accessAllowed = true;
const inventory: Inventory = {
  async isAccessTokenAllowed(){return accessAllowed;},
  async listDevices(owner,clientId): Promise<Device[]> {
    return owner === "user-a" && clientId === "test-client"
      ? [{id:mockProject.deviceId, alias:"Workstation", enabled:true, lastSeenAt:null, connected:false}]
      : [];
  },
  async listProjects(owner, clientId) { return owner === "user-a" && clientId === "test-client" ? [mockProject] : []; },
  async getProject(owner, clientId, projectId) { return owner === "user-a" && clientId === "test-client" && projectId === id ? mockProject : null; }
};
const managementCalls: unknown[] = [];
const grants: GrantManagement = {
  async revokeClient(owner,client) {
    managementCalls.push({owner,client,action:"revoke"});
    return owner==="user-a" ? 1 : 0;
  },
  async setGrant(owner, client, project, policy) {
    managementCalls.push({owner,client,project,policy});
    if (owner !== "user-a") return false;
    if (policy.maxMode === "write") throw new Error("POLICY_EXCEEDS_PROJECT");
    return project === id;
  }
};
const verify: Verifier = async token => {
  if (!["test-user-a","test-user-b","admin-user-a","rogue-admin"].includes(token)) throw new Error("invalid");
  const actor: Actor = {
    sub: token === "test-user-b" ? "user-b" : "user-a",
    clientId: token === "admin-user-a" ? "portal-client" : token === "rogue-admin" ? "other-client" : "test-client",
    scopes: new Set(["projects:read", ...(["admin-user-a","rogue-admin"].includes(token) ? ["projects:manage"] : [])]),
    issuedAt: Math.floor(Date.now()/1000)
  };
  return actor;
};
const config: Config = {
  host:"127.0.0.1", port:0, publicOrigin:"http://127.0.0.1",
  issuer:"https://issuer.example", jwksUrl:"https://issuer.example/keys",
  audience:"http://127.0.0.1/mcp", databaseUrl:"unused", allowedOrigins:[], managementClientId:"portal-client"
};
let server: Server;
let endpoint: string;
before(async () => {
  server = createHttpServer(config, inventory, verify, grants);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  endpoint = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
const headers = (token = "test-user-a", method?:string, name?:string) => ({
  "Authorization": "Bearer " + token,
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
  "MCP-Protocol-Version": "2026-07-28",
  ...(method ? {"Mcp-Method":method} : {}),
  ...(name ? {"Mcp-Name":name} : {})
});
function payload(method:string, params:object={}) {
  return JSON.stringify({jsonrpc:"2.0", id:1, method, params: {
    ...params, _meta:{"io.modelcontextprotocol/clientInfo":{name:"security-test",version:"1.0.0"},"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}
  }});
}
async function call(method:string, params:object={}, token = "test-user-a", toolName?:string) {
  const res = await fetch(endpoint+"/mcp", {
    method:"POST", headers:headers(token,method,toolName),
    body:payload(method,params)
  });
  return { status:res.status, data:await res.json() as Record<string,any> };
}
test("public health and OAuth resource discovery are metadata-only", async () => {
  const health = await fetch(endpoint+"/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).remoteConnector, "not_implemented");
  const meta = await fetch(endpoint+"/.well-known/oauth-protected-resource");
  assert.equal((await meta.json()).resource, config.audience);
  const nested = await fetch(endpoint+"/.well-known/oauth-protected-resource/mcp");
  assert.equal((await nested.json()).resource, config.audience);
});
test("MCP denies anonymous and invalid bearer traffic before tool discovery", async () => {
  const anon = await fetch(endpoint+"/mcp", {method:"POST",body:payload("tools/list"),headers:{"Content-Type":"application/json"}});
  assert.equal(anon.status,401);
  assert.match(anon.headers.get("www-authenticate")??"",/oauth-protected-resource/);
  const wrong = await call("tools/list",{},"invalid");
  assert.equal(wrong.status,401);
});
test("MCP tools/list advertises only bounded Cloud inventory tools", async () => {
  const out = await call("tools/list");
  assert.equal(out.status,200,JSON.stringify(out.data));
  const names=(out.data.result?.tools??[]).map((t:{name:string})=>t.name);
  assert.deepEqual(names.sort(), ["get_project","get_service_status","list_devices","list_projects"]);
  assert.equal(names.includes("pcb_delete_items"), false);
});
test("MCP calls are owner scoped; other users cannot discover projects", async () => {
  const a = await call("tools/call",{name:"list_projects",arguments:{}},"test-user-a","list_projects");
  assert.equal(a.status,200,JSON.stringify(a.data));
  assert.match(JSON.stringify(a.data),/USB-C Controller/);
  const b = await call("tools/call",{name:"list_projects",arguments:{}},"test-user-b","list_projects");
  assert.equal(b.status,200,JSON.stringify(b.data));
  assert.doesNotMatch(JSON.stringify(b.data),/USB-C Controller/);
  const foreign = await call("tools/call",{name:"get_project",arguments:{project_id:id}},"test-user-b","get_project");
  assert.equal(foreign.status,200,JSON.stringify(foreign.data));
  assert.doesNotMatch(JSON.stringify(foreign.data),/USB-C Controller/);
});
test("rejects untrusted browser Origin and oversized messages", async () => {
  const origin = await fetch(endpoint+"/mcp",{method:"POST",headers:{Origin:"https://attacker.example"},body:"{}"});
  assert.equal(origin.status,403);
  const large = await fetch(endpoint+"/mcp",{method:"POST",headers:headers(),body:" ".repeat(1048577)});
  assert.equal(large.status,413);
});
test("unknown URLs are not an enrollment API",async()=>{
  const r=await fetch(endpoint+"/api/devices",{method:"POST",headers:headers(),body:"{}"});
  assert.equal(r.status,404);
});


test("project grant endpoint requires first-party OAuth client and admin scope",async()=>{
  const path="/api/v1/projects/"+id+"/grants";
  const body=JSON.stringify({clientId:"claude-mcp-client",enabled:true,maxMode:"readonly"});
  async function send(token:string, value=body) {
    const result=await fetch(endpoint+path,{method:"PUT",headers:headers(token),body:value});
    return result.status;
  }
  assert.equal(await send("invalid"),401);
  assert.equal(await send("test-user-a"),403);
  assert.equal(await send("rogue-admin"),403);
  assert.equal(await send("admin-user-a",JSON.stringify({clientId:"client",enabled:true,maxMode:"readonly",localPath:"C:/Secrets"})),400);
  assert.equal(await send("admin-user-a",JSON.stringify({clientId:"client",enabled:true,maxMode:"write"})),409);
  assert.equal(await send("admin-user-a"),200);
  assert.deepEqual(managementCalls.at(-1),{
    owner:"user-a",client:"portal-client",project:id,
    policy:{clientId:"claude-mcp-client",enabled:true,maxMode:"readonly"}
  });
  const foreign=await fetch(endpoint+"/api/v1/projects/8a1dcd04-15d1-4354-86f5-2918b4a8b2e9/grants",{
    method:"PUT",headers:headers("admin-user-a"),body
  });
  assert.equal(foreign.status,404);
});


test("identity routes are proxied only when enabled, preserving response cookies",async()=>{
  const mockIdentity = {
    handler: async (request: Request) => {
      assert.equal(new URL(request.url).origin,config.publicOrigin);
      return new Response(JSON.stringify({authenticated:false}),{
        status:200,
        headers:{"content-type":"application/json","set-cookie":"state=opaque; Path=/; HttpOnly; SameSite=Lax"}
      });
    }
  };
  const proxy=createHttpServer(config,inventory,verify,grants,mockIdentity);
  await new Promise<void>(resolve=>proxy.listen(0,"127.0.0.1",resolve));
  const port=(proxy.address() as AddressInfo).port;
  try {
    const base="http://127.0.0.1:"+port;
    const discovery=await fetch(base+"/.well-known/oauth-authorization-server/api/auth");
    assert.equal(discovery.status,200);
    assert.match(discovery.headers.get("set-cookie")??"",/HttpOnly/);
    // Untrusted/opaque Origin on public GET navigation is harmless; the
    // browser must still complete the same-origin POST with CSRF checks.
    const navigation=await fetch(base+"/auth/start/github",{
      headers:{Origin:"null"},redirect:"manual"
    });
    assert.equal(navigation.status,303);
    assert.equal(navigation.headers.get("location"),"/sign-in");
    const publicSignIn=await fetch(base+"/sign-in",{headers:{Origin:"chrome-extension://fixture"}});
    assert.equal(publicSignIn.status,200);
    assert.match(await publicSignIn.text(),/Continue with GitHub/);
    const maliciousPost=await fetch(base+"/auth/start/github",{
      method:"POST",headers:{Origin:"null","Content-Type":"application/x-www-form-urlencoded"},
      body:"oauth_query=",redirect:"manual"
    });
    assert.equal(maliciousPost.status,403);
    const protectedRoute=await fetch(base+"/api/auth/jwks",{headers:{Origin:"null"}});
    assert.equal(protectedRoute.status,403);
    // Raw HTTP is needed: undici's fetch overrides the supplied Host header.
    const forgedHostStatus=await new Promise<number>((resolve,reject)=>{
      const req=httpRequest({hostname:"127.0.0.1",port,path:"/auth/start/github",
        headers:{Host:"forged.invalid",Origin:"null"}},response=>{
        response.resume();response.on("end",()=>resolve(response.statusCode??0));
      });
      req.on("error",reject);req.end();
    });
    assert.equal(forgedHostStatus,403);
    const keys=await fetch(base+"/api/auth/jwks");
    assert.equal(keys.status,200);
    assert.deepEqual(await keys.json(),{authenticated:false});
  } finally {
    await new Promise<void>(resolve=>proxy.close(()=>resolve()));
  }
});

test("consent URL is unreachable when built-in identity is disabled",async()=>{
  const response=await fetch(endpoint+"/consent?client_id=unknown");
  assert.equal(response.status,404);
});
test("HTTP consent rejects forged unsigned request even if identity is configured",async()=>{
  const mockIdentity={
    handler:async (_request:Request)=>Response.json({client_id:"unknown",client_name:"Unknown"}),
    $context:Promise.resolve({secret:"test-auth-secret-for-consent"}),
    api:{getSession:async()=>({user:{id:"test-user"}})}
  };
  const proxy=createHttpServer(config,inventory,verify,grants,mockIdentity as never);
  await new Promise<void>(resolve=>proxy.listen(0,"127.0.0.1",resolve));
  const port=(proxy.address() as AddressInfo).port;
  try{
    const response=await fetch("http://127.0.0.1:"+port+"/consent?client_id=unknown&scope=projects%3Aread");
    assert.equal(response.status,403);
    assert.doesNotMatch(await response.text(),/Approve<\/button>/);
  }finally{
    await new Promise<void>(resolve=>proxy.close(()=>resolve()));
  }
});

test("connection management is fail-closed without built-in identity",async()=>{
  assert.equal((await fetch(endpoint+"/connections")).status,404);
  const response=await fetch(endpoint+"/connections/revoke",{method:"POST",headers:{"Origin":config.publicOrigin,
    "Content-Type":"application/x-www-form-urlencoded"},body:"id=anything"});
  assert.equal(response.status,404);
});
test("HTTP connection list requires signed-in session",async()=>{
  const mockIdentity={
    handler:async()=>Response.json({client_id:"test"}),
    api:{getSession:async()=>null},
    $context:Promise.resolve({secret:"test-only-not-a-production-secret"})
  };
  const proxy=createHttpServer(config,inventory,verify,grants,mockIdentity as never);
  await new Promise<void>(resolve=>proxy.listen(0,"127.0.0.1",resolve));
  try {
    const port=(proxy.address() as AddressInfo).port;
    const res=await fetch("http://127.0.0.1:"+port+"/connections",{redirect:"manual"});
    assert.equal(res.status,303);
    assert.equal(res.headers.get("location"),"/sign-in");
  } finally {
    await new Promise<void>(resolve=>proxy.close(()=>resolve()));
  }
});


test("a revoked signed JWT is rejected at MCP and management edges",async()=>{
  accessAllowed=false;
  try {
    const mcp=await fetch(endpoint+"/mcp",{
      method:"POST",
      headers:headers("test-user-a"),
      body:JSON.stringify({jsonrpc:"2.0",id:731,method:"tools/list",params:{}})
    });
    assert.equal(mcp.status,401);
    assert.equal((await mcp.json()).error,"revoked_access_token");
    const grant=await fetch(endpoint+"/api/v1/projects/"+id+"/grants",{
      method:"PUT",headers:headers("admin-user-a"),
      body:JSON.stringify({clientId:"test-client",enabled:true,maxMode:"readonly"})
    });
    assert.equal(grant.status,401);
    assert.equal((await grant.json()).error,"revoked_access_token");
  } finally {
    accessAllowed=true;
  }
});

test("premium public interface and same-origin stylesheet use hardened headers",async()=>{
  const landing=await fetch(endpoint+"/");
  assert.equal(landing.status,200);
  assert.match(landing.headers.get("content-type")??"",/text\/html/);
  assert.match(landing.headers.get("content-security-policy")??"",/style-src 'self'/);
  const body=await landing.text();
  assert.match(body,/KiCad MCP Cloud/);
  assert.match(body,/Account access pending/);
  assert.doesNotMatch(body,/href="\/sign-in"/);
  const style=await fetch(endpoint+"/assets/ui.css");
  assert.equal(style.status,200);
  assert.match(style.headers.get("content-type")??"",/text\/css/);
  assert.match(await style.text(),/\.landing-panel/);
  assert.equal((await fetch(endpoint+"/assets/ui.js")).status,404);
});
