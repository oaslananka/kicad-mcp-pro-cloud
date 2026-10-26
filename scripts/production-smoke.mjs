import assert from "node:assert/strict";

const origin=process.argv[2]??process.env.PUBLIC_ORIGIN;
if(!origin) throw new Error("Pass production HTTPS origin explicitly");
const root=new URL(origin);
assert.equal(root.protocol,"https:","Only HTTPS production endpoints may be tested");
assert.equal(root.pathname,"/","Production origin must not contain a path");
const request=async (path,options={})=>{
  const response=await fetch(new URL(path,root),{
    redirect:"manual",
    signal:AbortSignal.timeout(15000),
    ...options
  });
  return response;
};
const html=await request("/");
assert.equal(html.status,200,"Premium overview must be public");
assert.match(html.headers.get("content-type")??"",/text\/html/);
assert.match(html.headers.get("content-security-policy")??"",/style-src 'self'/);
const page=await html.text();
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
