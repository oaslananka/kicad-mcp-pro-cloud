import assert from "node:assert/strict";

// This acceptance probe has one fixed, allowlisted public destination.
const root=new URL("https://kicad-mcp-pro.oaslananka.dev/");
const request=async (path,options={})=>{
  const response=await fetch(new URL(path,root),{
    redirect:"manual",
    signal:AbortSignal.timeout(15000),
    ...options
  });
  return response;
};
const landingResponse=await request("/");
assert.equal(landingResponse.status,200,"Premium overview must be public");
assert.match(landingResponse.headers.get("content-type")??"",/text\/html/);
assert.match(landingResponse.headers.get("content-security-policy")??"",/style-src 'self'/);
const page=await landingResponse.text();
assert.match(page,/Engineering, connected\./);
assert.match(page,/Account access pending/);
assert.doesNotMatch(page,/<script[\s>]/i);
assert.doesNotMatch(page,/href="\/sign-in"/);
const stylesheet=await request("/assets/ui.css");
assert.equal(stylesheet.status,200);
assert.match(stylesheet.headers.get("content-type")??"",/text\/css/);
assert.match(await stylesheet.text(),/\.feature-grid/);
const health=await request("/health");
assert.equal(health.status,200);
const status=await health.json();
assert.equal(status.status,"ok");
assert.equal(status.remoteConnector,"not_implemented",
  "Do not claim the local KiCad connector exists");
const metadata=await request("/.well-known/oauth-protected-resource");
assert.equal(metadata.status,200);
const resource=await metadata.json();
assert.equal(resource.resource,new URL("/mcp",root).href);
assert.ok(resource.authorization_servers?.includes(
  new URL("/api/auth",root).href));
const unauthenticated=await request("/mcp",{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",
    params:{protocolVersion:"2025-11-25",capabilities:{},
      clientInfo:{name:"production-smoke",version:"1.0"}}})
});
assert.equal(unauthenticated.status,401,"MCP must reject untrusted clients");
assert.equal((await request("/sign-in")).status,404,
  "Do not expose unfinished public OAuth sign-in");
console.log("Production smoke PASS: HTTPS, premium UI/CSS, health, MCP resource discovery, anonymous 401, login disabled");
