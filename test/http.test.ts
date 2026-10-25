import assert from "node:assert/strict";
import { createServer as httpCreateServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createHttpServer } from "../src/http.js";
import type { Config } from "../src/config.js";
import type { Inventory, Device, Project } from "../src/store.js";
import type { Actor, Verifier } from "../src/auth.js";

const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const mockProject: Project = {
  id, alias: "USB-C Controller", deviceId: "d108b5f4-22f2-4b3c-b62d-55163fa34814",
  enabled: true, maxMode: "readonly", available: false,
  reason: "remote_connector_not_implemented"
};
const inventory: Inventory = {
  async listDevices(owner): Promise<Device[]> {
    return owner === "user-a"
      ? [{id:mockProject.deviceId, alias:"Workstation", enabled:true, lastSeenAt:null, connected:false}]
      : [];
  },
  async listProjects(owner) { return owner === "user-a" ? [mockProject] : []; },
  async getProject(owner, projectId) { return owner === "user-a" && projectId === id ? mockProject : null; }
};
const verify: Verifier = async token => {
  if (token !== "test-user-a" && token !== "test-user-b") throw new Error("invalid");
  const actor: Actor = { sub:token === "test-user-a" ? "user-a" : "user-b", clientId:"test-client", scopes:new Set(["projects:read"]) };
  return actor;
};
const config: Config = {
  host:"127.0.0.1", port:0, publicOrigin:"http://127.0.0.1",
  issuer:"https://issuer.example", jwksUrl:"https://issuer.example/keys",
  audience:"http://127.0.0.1/mcp", databaseUrl:"unused", allowedOrigins:[]
};
let server: Server;
let endpoint: string;
before(async () => {
  server = createHttpServer(config, inventory, verify);
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
