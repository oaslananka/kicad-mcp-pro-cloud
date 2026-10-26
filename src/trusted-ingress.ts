import type {IncomingMessage} from "node:http";
import {BlockList,isIP} from "node:net";

export type RequestSourceResolver=(req:IncomingMessage)=>string|null;

/** Normalize all equivalent IPv6 spellings to a single rate-limit key. */
function ipAddress(raw:string):string|null{
  if(!raw||raw.length>64||raw!==raw.trim()||/[,\s%]/.test(raw))return null;
  const kind=isIP(raw);
  if(kind===4)return raw;
  if(kind===6){
    try{
      const host=new URL("https://["+raw+"]/").hostname;
      if(!host.startsWith("[")||!host.endsWith("]"))return null;
      const ipv6=host.slice(1,-1);
      // Both dotted and hexadecimal IPv4-mapped spellings must share one key.
      const mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ipv6);
      if(mapped){
        const hi=Number.parseInt(mapped[1],16),lo=Number.parseInt(mapped[2],16);
        return [hi>>8,hi&255,lo>>8,lo&255].join(".");
      }
      return ipv6;
    }catch{return null;}
  }
  return null;
}

/**
 * Accept client IP only when received from an explicitly pinned, exact
 * TCP proxy address. Never fall back to untrusted forwarding headers or
 * a shared Cloudflare Tunnel peer when the header is absent.
 *
 * The pinned peer must be a private, isolated tunnel origin connection
 * whose edge overwrites CF-Connecting-IP. No CIDR/wildcard trusting.
 */
export function trustedCloudflareSource(
  rawTrustedPeers:string|undefined
):RequestSourceResolver{
  if(!rawTrustedPeers)throw new Error("TRUSTED_CLOUDFLARED_PEERS_REQUIRED");
  const provided=rawTrustedPeers.split(",").map(v=>v.trim());
  if(!provided.length||provided.length>8||provided.some(v=>!v||
    v.includes("/")||v.includes("*")))throw new Error("INVALID_TRUSTED_CLOUDFLARED_PEERS");
  const block=new BlockList();
  const unique=new Set<string>();
  for(const address of provided){
    const normalized=ipAddress(address);
    if(!normalized||normalized==="0.0.0.0"||normalized==="::"||
       unique.has(normalized))
      throw new Error("INVALID_TRUSTED_CLOUDFLARED_PEERS");
    unique.add(normalized);
    block.addAddress(normalized,isIP(normalized)===6?"ipv6":"ipv4");
  }
  return req=>{
    const peer=ipAddress(req.socket.remoteAddress??"");
    if(!peer||!block.check(peer,isIP(peer)===6?"ipv6":"ipv4"))return null;
    // Reject duplicate headers regardless of Node's coalescing behavior.
    let count=0;
    let forwarded="";
    for(let i=0;i<req.rawHeaders.length;i+=2){
      if(req.rawHeaders[i]?.toLowerCase()==="cf-connecting-ip"){
        count++;
        forwarded=req.rawHeaders[i+1]??"";
      }
    }
    if(count!==1)return null;
    const client=ipAddress(forwarded);
    if(!client||client==="0.0.0.0"||client==="::")return null;
    return client;
  };
}
