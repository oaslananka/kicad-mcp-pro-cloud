// Read public deployment selectors from Doppler-injected environment.
// Never print the full environment, access tokens or credential-bearing URLs.
const origin=process.env.PUBLIC_ORIGIN??"";
let parsed;
try { parsed=new URL(origin); } catch { throw new Error("PUBLIC_ORIGIN_REQUIRED"); }
if(parsed.protocol!=="https:"||parsed.origin!==origin||parsed.username||parsed.password||
   parsed.search||parsed.hash||parsed.pathname!=="/")
  throw new Error("INVALID_PUBLIC_ORIGIN");
const network=process.env.KICAD_TUNNEL_NETWORK??"ops_internal";
if(!/^[A-Za-z][A-Za-z0-9_.-]{0,62}$/.test(network))
  throw new Error("INVALID_TUNNEL_NETWORK");
const githubId=process.env.GITHUB_CLIENT_ID??"";
const githubSecret=process.env.GITHUB_CLIENT_SECRET??"";
const googleId=process.env.GOOGLE_CLIENT_ID??"";
const googleSecret=process.env.GOOGLE_CLIENT_SECRET??"";
const github=Boolean(githubId&&githubSecret);
const google=Boolean(googleId&&googleSecret);
function checkProviderPairs(){
  if(Boolean(githubId)!==Boolean(githubSecret)||Boolean(googleId)!==Boolean(googleSecret))
    throw new Error("INCOMPLETE_OAUTH_PROVIDER_CREDENTIALS");
}
const kind=process.argv[2];
if(kind==="origin")process.stdout.write(origin+"\n");
else if(kind==="network")process.stdout.write(network+"\n");
else if(kind==="google"){
  checkProviderPairs();
  process.stdout.write(String(google)+"\n");
}else if(kind==="validate"){
  checkProviderPairs();
  const auth=process.env.AUTH_MODE??"external";
  if(!["external","builtin"].includes(auth))throw new Error("INVALID_AUTH_MODE");
  const issuer=process.env.OAUTH_ISSUER??"",jwks=process.env.OAUTH_JWKS_URL??"";
  const audience=process.env.OAUTH_AUDIENCE??"";
  if(audience!==origin+"/mcp")throw new Error("OAUTH_AUDIENCE_MISMATCH");
  if(auth==="builtin"&&(issuer!==origin+"/api/auth"||jwks!==origin+"/api/auth/jwks"))
    throw new Error("BUILTIN_OAUTH_ORIGIN_MISMATCH");
  for(const value of [issuer,jwks]){
    let url;try{url=new URL(value);}catch{throw new Error("INVALID_OAUTH_URL");}
    if(url.protocol!=="https:"||url.username||url.password)throw new Error("INVALID_OAUTH_URL");
  }
  if(!(process.env.KICAD_DB_PASSWORD??""))throw new Error("KICAD_DB_PASSWORD_REQUIRED");
  if(auth==="builtin"&&(!(process.env.BETTER_AUTH_SECRET??"")||!github))
    throw new Error("BUILTIN_GITHUB_OAUTH_CREDENTIALS_REQUIRED");
  if(process.env.PAIRING_DEVICE_API_ENABLED==="true"||process.env.CONNECTOR_WS_ENABLED==="true")
    throw new Error("DEVICE_ROLLOUT_REQUIRES_SEPARATE_SECURITY_ACCEPTANCE");
  process.stdout.write("Portable runtime configuration valid (secrets not printed)\n");
}else throw new Error("Usage: portable-config.mjs origin|network|google|validate");
