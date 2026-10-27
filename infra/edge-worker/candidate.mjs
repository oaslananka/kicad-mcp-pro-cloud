/**
 * OFFLINE REVIEW CANDIDATE, deliberately not deployed or routed.
 * This Worker must be bound only to the three exact device HTTP/WSS routes.
 * Original origin attribution and request semantics require live acceptance.
 */
const HOSTNAME="kicad-mcp-pro.oaslananka.dev";
const PATHS=new Map([
  ["/api/v1/pairing/device/challenge",{
    method:"POST",name:"challenge",source:"CHALLENGE_IP",global:"CHALLENGE_GLOBAL"
  }],
  ["/api/v1/pairing/device/redeem",{
    method:"POST",name:"redeem",source:"REDEEM_IP",global:"REDEEM_GLOBAL"
  }],
  ["/api/v1/connector/ws",{
    method:"GET",name:"wss",source:"WSS_IP",global:"WSS_GLOBAL"
  }]
]);
function canonicalIp(input){
  if(typeof input!=="string"||input.length>64||!input||
    input!==input.trim()||/[,\s%]/.test(input))return null;
  const isV6=input.includes(":");
  if(!isV6&&!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(input))return null;
  try{
    const url=new URL(isV6?"https://["+input+"]/":"https://"+input+"/");
    const host=url.hostname.replace(/^\[|\]$/g,"");
    if(!isV6&&host!==input)return null;
    if(isV6&&(!host.includes(":")||!/^[:a-f0-9.]+$/i.test(host)))return null;
    if(!isV6&&!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return null;
    if(host==="0.0.0.0"||host==="::")return null;
    // IPv4-mapped addresses must consume the IPv4 actor budget.
    const match=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
    if(match){
      const a=Number.parseInt(match[1],16),b=Number.parseInt(match[2],16);
      return [a>>8,a&255,b>>8,b&255].join(".");
    }
    return host;
  }catch{return null;}
}
function deny(status){
  return new Response(null,{
    status,
    headers:{
      "Cache-Control":"no-store",
      "Content-Security-Policy":"default-src 'none'",
      "X-Content-Type-Options":"nosniff"
    }
  });
}
export async function handleCandidate(request,env,forward){
  let parsed;
  try{parsed=new URL(request.url)}catch{return deny(400)}
  if(parsed.protocol!=="https:"||parsed.hostname!==HOSTNAME||
     parsed.port||parsed.search||parsed.hash)return deny(404);
  const route=PATHS.get(parsed.pathname);
  if(!route)return deny(404);
  if(request.method!==route.method)return deny(405);
  if(route.name==="wss"&&request.headers.get("Upgrade")?.toLowerCase()!=="websocket")
    return deny(426);
  const ip=canonicalIp(request.headers.get("CF-Connecting-IP"));
  if(!ip)return deny(403);
  const sourceLimiter=env?.[route.source],globalLimiter=env?.[route.global];
  if(typeof sourceLimiter?.limit!=="function"||
     typeof globalLimiter?.limit!=="function")return deny(503);
  try{
    // Approximate per-PoP limits only. Global binding counters are also
    // per Cloudflare location. Origin PostgreSQL quotas remain mandatory.
    const [actor,global]=await Promise.all([
      sourceLimiter.limit({key:route.name+":"+ip}),
      globalLimiter.limit({key:route.name+":all"})
    ]);
    if(actor?.success!==true||global?.success!==true)return deny(429);
  }catch{return deny(503)}
  if(typeof forward!=="function")return deny(503);
  // Do not rewrite Host, Authorization, CF-Connecting-IP or Upgrade.
  // A real Tunnel Worker subrequest may still modify source attribution:
  // this requires network acceptance before a route can be enabled.
  return forward(request);
}
export default {
  async fetch(request,env){
    return handleCandidate(request,env,r=>fetch(r));
  }
};
