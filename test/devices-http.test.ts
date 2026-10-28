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
let deviceEnabled=false;
const registeredProjects:Array<{id:string;deviceId:string;alias:string;enabled:boolean}>=[];
const devices:DeviceManagementPort={
  list:async(owner)=>owner==="owner-1"?[{
    id,alias:"My KiCad",enabled:deviceEnabled,revoked:false,
    fingerprint:"a".repeat(64),createdAt:new Date()
  }]:[],
  enableDevice:async(owner,device)=>{
    if(owner!=="owner-1"||device!==id)return false;
    deviceEnabled=true;return true;
  },
  createProject:async(owner,device,alias)=>{
    if(owner!=="owner-1"||device!==id||!deviceEnabled)return null;
    registeredProjects.push({id:"77777777-7777-4777-8777-777777777777",deviceId:device,
      alias,enabled:true});
    return registeredProjects.at(-1)?.id??null;
  },
  listProjects:async(owner)=>owner==="owner-1"?registeredProjects:[],
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


test("owner device activation and read-only project creation are disabled by default, CSRF scoped",
  async()=>{
  const disabled=await startServer(createHttpServer(config,inventory,async()=>{
    throw Error("unused");
  },undefined,identity,devices));
  try{
    const denied=await fetch(disabled.origin+"/devices/enable",{
      method:"POST",headers:{Origin:config.publicOrigin},body:""});
    assert.equal(denied.status,405);
  }finally{await disabled.close();}
  const enabled=await startServer(createHttpServer(config,inventory,async()=>{
    throw Error("unused");
  },undefined,identity,devices,undefined,{} as never));
  try{
    const page=await fetch(enabled.origin+"/devices");
    const html=await page.text();
    assert.match(html,/Enable my device/);
    const csrf=/<form action="\/devices\/enable"[\s\S]*?name="csrf" value="([^"]+)"/.exec(html)?.[1]??"";
    const wrong=/<form action="\/devices\/revoke"[\s\S]*?name="csrf" value="([^"]+)"/.exec(html)?.[1]??"";
    const cookie=(page.headers.get("set-cookie")??"").split(";")[0];
    assert.ok(csrf&&wrong);
    const headers={"Content-Type":"application/x-www-form-urlencoded",
      Origin:config.publicOrigin,Cookie:cookie};
    const send=(path:string,body:URLSearchParams)=>fetch(enabled.origin+path,{
      method:"POST",headers,body,redirect:"manual"});
    assert.equal((await send("/devices/enable",new URLSearchParams({device_id:id,csrf:wrong}))).status,403);
    assert.equal(deviceEnabled,false);
    assert.equal((await send("/devices/enable",new URLSearchParams({device_id:id,csrf}))).status,303);
    assert.equal(deviceEnabled,true);
    const updated=await fetch(enabled.origin+"/devices");
    const projectHtml=await updated.text();
    assert.match(projectHtml,/Register read-only project/);
    const projectCsrf=/<form action="\/devices\/projects\/create"[\s\S]*?name="csrf" value="([^"]+)"/.exec(projectHtml)?.[1]??"";
    const projectCookie=(updated.headers.get("set-cookie")??"").split(";")[0];
    assert.ok(projectCsrf);
    const created=await fetch(enabled.origin+"/devices/projects/create",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",
        Origin:config.publicOrigin,Cookie:projectCookie},redirect:"manual",
      body:new URLSearchParams({device_id:id,alias:"Approved Demo",csrf:projectCsrf})
    });
    assert.equal(created.status,303);
    assert.equal(registeredProjects.at(-1)?.alias,"Approved Demo");
    const refreshed=await (await fetch(enabled.origin+"/devices")).text();
    assert.match(refreshed,/77777777-7777-4777-8777-777777777777/);
    assert.doesNotMatch(refreshed,/local file path/i);
  }finally{await enabled.close();}
});
