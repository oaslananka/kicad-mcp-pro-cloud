import assert from "node:assert/strict";

// All destinations are fixed production URLs, never user-provided paths.
// This probe sends only an anonymous read/initialize request.
const options={redirect:"manual",signal:AbortSignal.timeout(15000)};
const landingResponse=await fetch("https://kicad-mcp-pro.oaslananka.dev/",options);
assert.equal(landingResponse.status,200,"Premium overview must be public");
assert.match(landingResponse.headers.get("content-type")??"",/text\/html/);
assert.match(landingResponse.headers.get("content-security-policy")??"",/style-src 'self'/);
const page=await landingResponse.text();
assert.match(page,/Engineering, connected\./);
assert.match(page,/Account access pending/);
assert.doesNotMatch(page,/<script[\s>]/i);
assert.doesNotMatch(page,/href="\/sign-in"/);

const stylesheet=await fetch("https://kicad-mcp-pro.oaslananka.dev/assets/ui.css",options);
assert.equal(stylesheet.status,200);
assert.match(stylesheet.headers.get("content-type")??"",/text\/css/);
assert.match(await stylesheet.text(),/\.feature-grid/);

const health=await fetch("https://kicad-mcp-pro.oaslananka.dev/health",options);
assert.equal(health.status,200);
const status=await health.json();
assert.equal(status.status,"ok");
assert.equal(status.remoteConnector,"not_implemented",
  "Do not claim the local KiCad connector exists");

const metadata=await fetch("https://kicad-mcp-pro.oaslananka.dev/.well-known/oauth-protected-resource",options);
assert.equal(metadata.status,200);
const resource=await metadata.json();
assert.equal(resource.resource,"https://kicad-mcp-pro.oaslananka.dev/mcp");
assert.deepEqual(resource.authorization_servers,
  ["https://kicad-mcp-pro.oaslananka.dev/api/auth"],
  "OAuth authorization server must match this production origin exactly");

const unauthenticated=await fetch("https://kicad-mcp-pro.oaslananka.dev/mcp",{
  method:"POST",redirect:"manual",signal:AbortSignal.timeout(15000),
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",
    params:{protocolVersion:"2025-11-25",capabilities:{},
      clientInfo:{name:"production-smoke",version:"1.0"}}})
});
assert.equal(unauthenticated.status,401,"MCP must reject untrusted clients");
const signIn=await fetch("https://kicad-mcp-pro.oaslananka.dev/sign-in",options);
assert.equal(signIn.status,404,"Unreleased public OAuth sign-in must remain disabled");
console.log("Production smoke PASS: HTTPS, premium UI/CSS, health, MCP resource discovery, anonymous 401, login disabled");
