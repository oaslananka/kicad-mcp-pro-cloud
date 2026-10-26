import {type IncomingMessage, type Server} from "node:http";
import type {Socket} from "node:net";
import {WebSocket,WebSocketServer} from "ws";
import {z} from "zod";
import {BoundConnectorConnections} from "./connector-transport-binding.js";
import type {PgDeviceHandshakes} from "./device-handshake.js";

export type DeviceProofPort=Pick<PgDeviceHandshakes,"issue"|"verify"|"cancel">;
type State="new"|"device_challenge"|"session_challenge"|"ready"|"closed";
type Entry={
  phase:State; owner:string; device:string; challenge:string; nonce:string;
  queued:number; pending:Promise<void>; timer:NodeJS.Timeout | null;
  lastPong:number; sessionDeadline?:number;
};
const hello=z.strictObject({
  kind:z.literal("device.hello"),version:z.literal(1),
  ownerSub:z.string().min(1).max(256),deviceId:z.uuid()
});
const proof=z.strictObject({kind:z.literal("device.proof"),version:z.literal(1),
  signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)});
const sessionProof=z.strictObject({kind:z.literal("connector.session_proof"),version:z.literal(1),
  signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)});
const CLOSE_POLICY=1008;
const MAX_SOCKETS=96;
const MAX_PER_IP=6;
const MAX_PER_MINUTE=12;
const MINUTE=60_000;
const INITIAL_TIMEOUT=15_000;
const PROOF_TIMEOUT=60_000;
const MAX_SESSION=300_000;

function decodeSignature(raw:string):Buffer|null{
  const bytes=Buffer.from(raw,"base64url");
  return bytes.length===64&&bytes.toString("base64url")===raw?bytes:null;
}
function denyUpgrade(socket:Socket,status=403):void{
  if(socket.destroyed)return;
  socket.end("HTTP/1.1 "+status+" Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}
function isAllowedUpgrade(req:IncomingMessage,origin:string):boolean{
  const expected=new URL(origin);
  return req.method==="GET"&&req.url==="/api/v1/connector/ws"&&
    req.headers.host===expected.host&&
    // No browser-initiated WebSockets, cookies, bearer tokens or claimed protocol.
    req.headers.origin===undefined&&req.headers.cookie===undefined&&
    req.headers.authorization===undefined&&
    req.headers["sec-websocket-protocol"]===undefined&&
    req.headers["sec-websocket-extensions"]===undefined;
}
function asJson(raw:Buffer):unknown{
  try{return JSON.parse(raw.toString("utf8")) as unknown;}catch{return null;}
}
/**
 * Live WebSocket transport for an outbound device-initiated connection.
 * Feature gated OFF by default. No MCP/AI command relay or KiCad operation.
 * TLS termination MUST be enforced by a trusted ingress before activation
 * in production; the upgrade route itself is HTTP on the internal listener.
 */
export function attachConnectorWebSocket(
  httpServer:Server,
  options:{
    publicOrigin:string;
    proofs:DeviceProofPort;
    connections:BoundConnectorConnections;
    maxConnections?:number;
  }
):{close:()=>Promise<void>}{
  const wss=new WebSocketServer({noServer:true,perMessageDeflate:false,
    maxPayload:1024,clientTracking:true});
  const sockets=new Set<WebSocket>();
  const ipOpen=new Map<string,number>();
  const ipWindows=new Map<string,{start:number,count:number}>();
  // Per-device throttle limits challenge reservation from self-claimed IDs.
  // Distributed DoS limits are still required before feature activation.
  const deviceWindows=new Map<string,{start:number,count:number}>();
  let stopped=false;

  function allowWindow(buckets:Map<string,{start:number,count:number}>,
    id:string,max:number):boolean{
    const now=Date.now();
    const prior=buckets.get(id);
    if(!prior||now-prior.start>=MINUTE){
      buckets.set(id,{start:now,count:1});return true;
    }
    if(prior.count>=max)return false;
    prior.count++;return true;
  }
  function reject(ws:WebSocket):void{
    if(ws.readyState===WebSocket.OPEN)ws.close(CLOSE_POLICY,"policy");
    else ws.terminate();
  }
  const upgrade=(req:IncomingMessage,socket:Socket,head:Buffer):void=>{
    const ip=req.socket.remoteAddress??"unknown";
    if(stopped||!isAllowedUpgrade(req,options.publicOrigin)){
      denyUpgrade(socket);return;
    }
    if(sockets.size>=(options.maxConnections??MAX_SOCKETS)||
       (ipOpen.get(ip)??0)>=MAX_PER_IP||
       !allowWindow(ipWindows,ip,MAX_PER_MINUTE)){
      denyUpgrade(socket,429);return;
    }
    try{
      wss.handleUpgrade(req,socket,head,ws=>{
        sockets.add(ws);
        ipOpen.set(ip,(ipOpen.get(ip)??0)+1);
        const entry:Entry={phase:"new",owner:"",device:"",challenge:"",
          nonce:"",queued:0,pending:Promise.resolve(),timer:null,lastPong:Date.now()};
        function expire(ms:number):void{
          if(entry.timer)clearTimeout(entry.timer);
          entry.timer=setTimeout(()=>{entry.phase="closed";reject(ws);},ms);
          entry.timer.unref();
        }
        function closed():boolean{return entry.phase==="closed";}
        function fail():void{
          entry.phase="closed";
          reject(ws);
        }
        function send(msg:object):void{
          if(ws.readyState!==WebSocket.OPEN)throw Error("socket_closed");
          ws.send(JSON.stringify(msg));
        }
        async function cancelChallenge():Promise<void>{
          if(entry.challenge){
            const id=entry.challenge;
            entry.challenge="";
            await options.proofs.cancel(entry.owner,entry.device,id);
          }
        }
        async function frame(payload:Buffer,isBinary:boolean):Promise<void>{
          if(entry.phase==="closed"||isBinary||payload.length===0||payload.length>1024){
            fail();return;
          }
          const raw=asJson(payload);
          if(entry.phase==="new"){
            const parsed=hello.safeParse(raw);
            if(!parsed.success ||
               !allowWindow(deviceWindows,parsed.data.ownerSub+":"+parsed.data.deviceId,5)){
              fail();return;
            }
            entry.owner=parsed.data.ownerSub;entry.device=parsed.data.deviceId;
            const issue=await options.proofs.issue(entry.owner,entry.device);
            if(issue.kind!=="issued"){fail();return;}
            entry.challenge=issue.challengeId;entry.nonce=issue.nonce;
            if(ws.readyState!==WebSocket.OPEN||closed()){
              await cancelChallenge();return;
            }
            entry.phase="device_challenge";
            expire(Math.min(PROOF_TIMEOUT,Math.max(1,issue.expiresAtMs-Date.now())));
            send({kind:"device.challenge",version:1,challengeId:issue.challengeId,
              deviceId:issue.deviceId,nonce:issue.nonce,expiresAtMs:issue.expiresAtMs});
            return;
          }
          if(entry.phase==="device_challenge"){
            const parsed=proof.safeParse(raw);
            const signature=parsed.success?decodeSignature(parsed.data.signature):null;
            if(!signature){fail();return;}
            const verified=await options.proofs.verify(entry.owner,entry.device,
              entry.challenge,entry.nonce,signature);
            if(verified.kind!=="verified"){fail();return;}
            entry.challenge="";entry.nonce="";
            if(ws.readyState!==WebSocket.OPEN||closed())return;
            const session=await options.connections.begin(ws,{
              ownerSub:entry.owner,deviceId:verified.deviceId});
            if(session.kind!=="issued"){fail();return;}
            if(ws.readyState!==WebSocket.OPEN||closed()){
              await options.connections.disconnect(ws);return;
            }
            entry.phase="session_challenge";
            entry.sessionDeadline=Date.now()+MAX_SESSION;
            expire(Math.min(PROOF_TIMEOUT,Math.max(1,session.expiresAtMs-Date.now())));
            send({kind:"connector.session_challenge",version:1,
              sessionId:session.sessionId,challengeId:session.challengeId,
              deviceId:verified.deviceId,nonce:session.nonce,binding:session.binding,
              expiresAtMs:session.expiresAtMs});
            return;
          }
          if(entry.phase==="session_challenge"){
            const parsed=sessionProof.safeParse(raw);
            const signature=parsed.success?decodeSignature(parsed.data.signature):null;
            if(!signature||!await options.connections.activate(ws,signature)){
              fail();return;
            }
            if(closed()||ws.readyState!==WebSocket.OPEN)return;
            entry.phase="ready";
            expire(Math.max(1,(entry.sessionDeadline??0)-Date.now()));
            send({kind:"connector.ready",version:1});
            return;
          }
          // No remote operation or arbitrary frame is implemented.
          fail();
        }
        expire(INITIAL_TIMEOUT);
        ws.on("pong",()=>{entry.lastPong=Date.now();});
        ws.on("message",(data,isBinary)=>{
          if(closed()){fail();return;}
          entry.queued++;
          if(entry.queued>4){fail();return;}
          const bytes=Buffer.isBuffer(data)?data:Buffer.from(data as ArrayBuffer);
          entry.pending=entry.pending.then(()=>frame(bytes,isBinary))
            .catch(()=>{fail();}).finally(()=>{entry.queued--;});
        });
        ws.on("close",()=>{
          entry.phase="closed";
          if(entry.timer)clearTimeout(entry.timer);
          sockets.delete(ws);
          const count=(ipOpen.get(ip)??1)-1;
          if(count<=0)ipOpen.delete(ip);else ipOpen.set(ip,count);
          void Promise.allSettled([
            cancelChallenge(),
            options.connections.disconnect(ws)
          ]);
        });
        ws.on("error",()=>{fail();});
      });
    }catch{denyUpgrade(socket);}
  };
  httpServer.on("upgrade",upgrade);
  const heartbeat=setInterval(()=>{
    const now=Date.now();
    for(const ws of sockets){
      // ping/pong checks transport liveness, NOT extension of DB lease.
      const e=(ws as WebSocket & {isAlive?:boolean});
      if(e.isAlive===false){reject(ws);continue;}
      e.isAlive=false;
      ws.once("pong",()=>{e.isAlive=true;});
      if(ws.readyState===WebSocket.OPEN)ws.ping();
    }
    if(ipWindows.size>1024)for(const [ip,b] of ipWindows)
      if(now-b.start>=MINUTE)ipWindows.delete(ip);
    if(deviceWindows.size>1024)for(const [id,b] of deviceWindows)
      if(now-b.start>=MINUTE)deviceWindows.delete(id);
  },30_000);
  heartbeat.unref();
  return {close:async()=>{
    if(stopped)return;
    stopped=true;
    clearInterval(heartbeat);
    httpServer.off("upgrade",upgrade);
    for(const ws of sockets)ws.terminate();
    await new Promise<void>(resolve=>wss.close(()=>resolve()));
  }};
}
