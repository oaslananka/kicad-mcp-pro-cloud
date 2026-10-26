import assert from "node:assert/strict";
import {createServer,type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {test} from "node:test";
import {randomUUID} from "node:crypto";
import {createHttpServer} from "../src/http.js";
import type {Config} from "../src/config.js";
import type {Inventory} from "../src/store.js";
import type {BrowserIdentity} from "../src/browser.js";
import type {DeviceManagementPort} from "../src/devices.js";

const id=randomUUID();
const config:Config={
  host:"127.0.0.1",port:0,publicOrigin:"http://127.0.0.1",
  issuer:"https://issuer.example",jwksUrl:"https://issuer.example/jwks",
  audience:"http://127.0.0.1/mcp",databaseUrl:"not-used",
  allowedOrigins:[],managementClientId:"manager"
};
const inventory={
  isAccessTokenAllowed:async()=>false,
  listDevices:async()=>[],listProjects:async()=>[],getProject:async()=>null
} as Inventory;
const identity={
  handler:async()=>new Response(null,{status:404}),
  $context:Promise.resolve({secret:"test-http-devices-secret-minimum-thirty-two-bytes"}),
  api:{getSession:async()=>({session:{id:"owner-session"},user:{id:"owner-1"}})}
} as unknown as BrowserIdentity;
const calls:string[]=[];
const devices:DeviceManagementPort={
  list:async(owner)=>owner==="owner-1"?[{
    id,alias:"My KiCad",enabled:false,revoked:false,
    fingerprint:"a".repeat(64),createdAt:new Date()
  }]:[],
  revokeDevice:async(owner,device)=>{
    calls.push(owner+":"+device);
    return owner==="owner-1"&&device===id;
  }
};
async function startServer(server:Server):Promise<{origin:string;close:()=>Promise<void>}>{
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  return {origin,close:()=>new Promise(resolve=>server.close(()=>resolve()))};
}
test("HTTP device routes are absent without builtin identity",async()=>{
  const s=await startServer(createHttpServer(config,inventory,async()=>{
    throw Error("invalid");
  }));
  try{
    const res=await fetch(s.origin+"/devices");
    assert.equal(res.status,404);
    const action=await fetch(s.origin+"/devices/revoke",{
      method:"POST",body:"device_id="+id,
      headers:{Origin:config.publicOrigin}
    });
    assert.equal(action.status,404);
  }finally{await s.close();}
});
test("HTTP device revocation uses verified browser session plus CSRF",async()=>{
  const s=await startServer(createHttpServer(config,inventory,async()=>{
    throw Error("unused");
  },undefined,identity,devices));
  try{
    const view=await fetch(s.origin+"/devices");
    assert.equal(view.status,200);
    const html=await view.text();
    assert.match(html,/My KiCad/);
    const token=/name="csrf" value="([^"]+)"/.exec(html)?.[1]??"";
    assert.ok(token);
    const cookie=(view.headers.get("set-cookie")??"").split(";")[0];
    const form=new URLSearchParams({device_id:id,csrf:token});
    const denied=await fetch(s.origin+"/devices/revoke",{
      method:"POST",headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        Cookie:cookie,Origin:"https://attacker.example"
      },body:form,redirect:"manual"
    });
    assert.equal(denied.status,403);
    const success=await fetch(s.origin+"/devices/revoke",{
      method:"POST",headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        Cookie:cookie,Origin:config.publicOrigin
      },body:form,redirect:"manual"
    });
    assert.equal(success.status,303);
    assert.equal(success.headers.get("location"),"/devices?revoked=1");
    assert.deepEqual(calls,["owner-1:"+id]);
  }finally{await s.close();}
});
