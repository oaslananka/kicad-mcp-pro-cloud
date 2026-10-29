import assert from "node:assert/strict";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {test} from "node:test";
import type {RegistrationResponseJSON} from "@simplewebauthn/server";
import {createOwnerRegistrationHandler} from "../src/owner-read-registration-http.js";
import type {PgOwnerReadPasskeyRegistration}
  from "../src/owner-read-passkey-registration.js";

test("isolated registration endpoints require independent owner, strict origin and CSRF",
  async()=>{
  const expectedOrigin="https://approver.example.test";
  const csrf="test-only-unpredictable-session-secret-012345";
  let called=0,completions=0;
  let issued="";
  const registration={
    begin:async(owner:string,requestId:string)=>{
      assert.equal(owner,"trusted-owner");
      assert.match(requestId,/^[0-9a-f-]{36}$/);
      called++;issued=requestId;
      return {rp:{name:"KiCad",id:"approver.example.test"},
        challenge:"A".repeat(43)};
    },
    complete:async(owner:string,requestId:string,proof:RegistrationResponseJSON)=>{
      assert.equal(owner,"trusted-owner");
      assert.equal(requestId,issued);
      assert.equal(proof.id,"signed-passkey-response");
      completions++;
      return completions===1?"registered_inactive":"denied";
    }
  } as unknown as PgOwnerReadPasskeyRegistration;
  // Synthetic owner-session verifier. This explicit injected trust boundary
  // is NOT an approved production authentication implementation.
  const handler=createOwnerRegistrationHandler(registration,expectedOrigin,
    async req=>req.headers["x-fixture-auth"]==="authenticated"?
      {ownerSub:"trusted-owner",csrf}:null);
  const server=createServer((req,res)=>{void handler(req,res);});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const addr=server.address() as AddressInfo;
  const root="http://127.0.0.1:"+addr.port;
  const begin="/owner-passkey/register/begin";
  const complete="/owner-passkey/register/complete";
  const post=(path:string,body:unknown,headers:Record<string,string>={})=>
    fetch(root+path,{method:"POST",headers:{
      Origin:expectedOrigin,"Content-Type":"application/json",
      "Sec-Fetch-Site":"same-origin","X-Fixture-Auth":"authenticated",...headers},
    body:JSON.stringify(body)});
  try{
    assert.equal((await post(begin,{csrf},{
      "X-Fixture-Auth":"anonymous"})).status,403);
    assert.equal((await post(begin,{csrf},{
      Origin:"https://attacker.example.test"})).status,403);
    assert.equal((await post(begin,{csrf},{
      "Sec-Fetch-Site":"cross-site"})).status,403);
    assert.equal((await post(begin,{csrf:"incorrect"})).status,403);
    assert.equal((await post(begin,{csrf},{
      "Content-Type":"text/plain"})).status,403);
    assert.equal((await fetch(root+begin)).status,403);
    assert.equal((await post("/other",{csrf})).status,404);
    assert.equal(called,0,"Untrusted requests must not start passkey challenges");
    const started=await post(begin,{csrf,
      ownerSub:"attacker-injected",requestId:"attacker-injected"});
    assert.equal(started.status,200);
    assert.equal(started.headers.get("cache-control"),"no-store");
    const payload=await started.json() as {requestId:string;
      options:{rp:{id:string}}};
    assert.match(payload.requestId,/^[0-9a-f-]{36}$/);
    assert.notEqual(payload.requestId,"attacker-injected");
    assert.equal(payload.options.rp.id,"approver.example.test");
    assert.equal(called,1);
    const assertion={id:"signed-passkey-response"} as RegistrationResponseJSON;
    assert.equal((await post(complete,{csrf,
      requestId:payload.requestId,response:assertion})).status,201);
    assert.equal((await post(complete,{csrf,
      requestId:payload.requestId,response:assertion})).status,403,
      "No repeat registration through the endpoint");
    assert.equal(completions,2);
    assert.equal((await post(begin,{csrf,large:"X".repeat(20_000)})).status,413);
    assert.equal(called,1,"Large bodies must not start a registration");
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
