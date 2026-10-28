import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {test} from "node:test";
import {WebSocket} from "ws";
import {attachConnectorWebSocket,type DeviceProofPort} from "../src/connector-ws.js";
import type {BoundConnectorConnections} from "../src/connector-transport-binding.js";

// A purely isolated socket and injected asynchronous grant check: no DB,
// OAuth identity, public ingress, or production deployment is contacted.
function nextFrame(ws:WebSocket):Promise<Record<string,unknown>>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(Error("SOCKET_TIMEOUT"));},4000);
    function onMessage(data:WebSocket.RawData){
      cleanup();
      try{resolve(JSON.parse(data.toString()) as Record<string,unknown>);}
      catch{reject(Error("BAD_JSON"));}
    }
    function onClose(){cleanup();reject(Error("SOCKET_CLOSED"));}
    function cleanup(){
      clearTimeout(timer);ws.off("message",onMessage);ws.off("close",onClose);
    }
    ws.once("message",onMessage);ws.once("close",onClose);
  });
}

for(const scenario of ["expired-deadline","stalled-grant","disconnected-grant"] as const){
test(scenario==="expired-deadline" ?
  "a result finishing its async grant check after request deadline is never delivered" :
  scenario==="stalled-grant" ?
  "read timeout remains armed while the last DB grant check is pending" :
  "closed WebSocket releases HTTP wait even if final DB check is pending",
  {timeout:12_000},async()=>{
  const owner="synthetic-owner",device=randomUUID(),project=randomUUID();
  const session=randomUUID(),challenge=randomUUID();
  const proofs={
    issue:async()=>({kind:"issued",challengeId:challenge,deviceId:device,
      nonce:"N".repeat(43),expiresAtMs:Date.now()+60_000}),
    verify:async()=>({kind:"verified",deviceId:device}),
    cancel:async()=>true
  } as unknown as DeviceProofPort;
  let resolveSecond!:(allowed:boolean)=>void;
  const delayedSecond=new Promise<boolean>(resolve=>{resolveSecond=resolve;});
  let signalSecond!:()=>void;
  const secondStarted=new Promise<void>(resolve=>{signalSecond=resolve;});
  let checks=0;
  const connections={
    begin:async()=>({kind:"issued",sessionId:session,challengeId:randomUUID(),
      nonce:"N".repeat(43),binding:"B".repeat(43),expiresAtMs:Date.now()+60_000}),
    activate:async()=>true,
    authorizeOutgoingSummary:async()=>{
      checks++;
      if(checks===1)return true;
      signalSecond();
      return delayedSecond;
    },
    disconnect:async()=>{}
  } as unknown as BoundConnectorConnections;
  const http=createServer((_request,response)=>{response.writeHead(404);response.end();});
  await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));
  const port=(http.address() as AddressInfo).port;
  const relay=attachConnectorWebSocket(http,{
    publicOrigin:"http://127.0.0.1:"+port,
    sourceOf:()=>"127.0.0.1",proofs,connections
  });
  let ws:WebSocket|undefined;
  const originalNow=Date.now;
  const originalTimeout=globalThis.setTimeout;
  try{
    ws=await new Promise<WebSocket>((resolve,reject)=>{
      const socket=new WebSocket("ws://127.0.0.1:"+port+"/api/v1/connector/ws",{perMessageDeflate:false});
      socket.once("open",()=>resolve(socket));
      socket.once("error",reject);
    });
    let next=nextFrame(ws);
    ws.send(JSON.stringify({kind:"device.hello",version:1,ownerSub:owner,deviceId:device}));
    assert.equal((await next).kind,"device.challenge");
    next=nextFrame(ws);
    ws.send(JSON.stringify({kind:"device.proof",version:1,
      signature:Buffer.alloc(64,3).toString("base64url")}));
    assert.equal((await next).kind,"connector.session_challenge");
    next=nextFrame(ws);
    ws.send(JSON.stringify({kind:"connector.session_proof",version:1,
      signature:Buffer.alloc(64,4).toString("base64url")}));
    assert.equal((await next).kind,"connector.ready");

    next=nextFrame(ws);
    if(scenario==="stalled-grant"){
      // Speed up only the server's 12s request watchdog; never change its
      // authorization deadline or alter any production code.
      globalThis.setTimeout=((...args:Parameters<typeof setTimeout>)=>{
        const [handler,delay,...rest]=args;
        return originalTimeout(handler,delay===12_000?80:delay,...rest);
      }) as typeof setTimeout;
    }
    const pending=relay.requestSummary({ownerSub:owner,clientId:"synthetic-client",
      accessTokenIssuedAtSeconds:Math.floor(Date.now()/1000)},device,project);
    const sent=await next;
    globalThis.setTimeout=originalTimeout;
    assert.equal(sent.kind,"connector.authorized_read");
    const request=sent.request as Record<string,unknown>;
    const deadline=request.deadlineUnixMs as number;
    const reply={kind:"connector.read_result",version:1,sequence:1,
      result:{kind:"connector.local_read_preview",version:1,
        requestId:request.requestId,projectId:project,operation:"project_summary",
        files:{projectPresent:true,boardPresent:false,schematicPresent:false}}};
    const closed=new Promise<number>(resolve=>ws!.once("close",resolve));
    let ackDelivered=false;
    ws.on("message",data=>{
      const frame=JSON.parse(data.toString()) as Record<string,unknown>;
      if(frame.kind==="connector.read_ack")ackDelivered=true;
    });
    ws.send(JSON.stringify(reply));
    await secondStarted;
    if(scenario==="expired-deadline"){
      // The time of the authorization result (not only its start) matters.
      Date.now=()=>deadline+1;
      resolveSecond(true);
      assert.equal(await pending,null,
        "an approved result that outlives its signed deadline must be discarded");
    }else if(scenario==="stalled-grant"){
      // The final database grant can hang: the independent request budget
      // must complete with null without ever waiting for DB resolution.
      const state=await Promise.race([
        pending, new Promise<"timeout-not-armed">(resolve=>
          originalTimeout(()=>resolve("timeout-not-armed"),350))
      ]);
      assert.equal(state,null,"the in-flight final grant must retain its watchdog");
      resolveSecond(true);
    }else{
      // No read-result relay promise should survive a device disconnect.
      ws.terminate();
      const state=await Promise.race([
        pending, new Promise<"close-not-settled">(resolve=>
          originalTimeout(()=>resolve("close-not-settled"),350))
      ]);
      assert.equal(state,null,"closed device must settle a pending Cloud read");
      resolveSecond(false);
    }
    assert.equal(checks,2);
    assert.equal(await closed,scenario==="disconnected-grant"?1006:1008,
      "expired or disconnected read must close without an ACK");
    assert.equal(ackDelivered,false,"never acknowledge an expired metadata response");
  }finally{
    Date.now=originalNow;
    globalThis.setTimeout=originalTimeout;
    resolveSecond(false);
    ws?.terminate();
    await relay.close();
    await new Promise<void>(resolve=>http.close(()=>resolve()));
  }
});
}
