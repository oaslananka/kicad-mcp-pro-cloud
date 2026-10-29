import assert from "node:assert/strict";
import {createHmac,randomBytes,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {createServer,type Server} from "node:https";
import {request as httpsRequest} from "node:https";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import {createIdentity} from "../src/identity.js";
import {createIndependentOwnerSessionVerifier}
  from "../src/owner-read-better-auth-session.js";
import {createOwnerRegistrationHandler}
  from "../src/owner-read-registration-http.js";
import {createOwnerPasskeyEnrollmentPageHandler}
  from "../src/owner-read-enrollment-ui.js";
import type {PgOwnerReadPasskeyRegistration}
  from "../src/owner-read-passkey-registration.js";
import {inIsolatedDatabase} from "./isolated-db.js";

const url=process.env.TEST_DATABASE_URL;
const authority="https://localhost";
test("real Better Auth session gates standalone HTTPS owner page and registration POST",
  {skip:!url,timeout:40_000},async()=>{
    await inIsolatedDatabase(url!,["003_better_auth.pgsql"],async db=>{
      const tmp=await mkdtemp(path.join(tmpdir(),"cloud-owner-session-http-"));
      let server:Server|undefined;
      try{
        const cert=path.join(tmp,"cert.pem");
        const key=path.join(tmp,"key.pem");
        execFileSync("openssl",["req","-x509","-newkey","rsa:2048",
          "-sha256","-nodes","-days","1","-keyout",key,"-out",cert,
          "-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost"],
        {stdio:"ignore"});
        const secret=randomBytes(48).toString("hex");
        const owner="approved-owner",sessionId=randomUUID();
        const token=randomBytes(32).toString("base64url");
        const now=new Date(),expiry=new Date(Date.now()+20*60_000);
        await db.query('INSERT INTO "users"'+
          '("id","name","email","emailVerified") VALUES($1,$2,$3,true)',
          [owner,"Account owner","owner@test.invalid"]);
        await db.query('INSERT INTO "session"'+
          '("id","expiresAt","token","updatedAt","userId")'+
          ' VALUES($1,$2,$3,$4,$5)',[sessionId,expiry,token,now,owner]);
        const cookie="__Secure-better-auth.session_token="+
          encodeURIComponent(token+"."+
            createHmac("sha256",secret).update(token).digest("base64"));
        const identity=createIdentity({
          publicOrigin:authority,audience:authority+"/mcp",databaseUrl:url!
        },{secret,googleId:"",googleSecret:"",
          githubId:"synthetic-provider-id",githubSecret:"synthetic-provider-secret"},db);
        const verify=createIndependentOwnerSessionVerifier(
          identity,authority,owner,randomBytes(48));
        let begins=0;
        const mock={
          begin:async(identitySub:string,requestId:string)=>{
            assert.equal(identitySub,owner);
            assert.match(requestId,/^[0-9a-f-]{36}$/);
            begins++;
            return {challenge:"A".repeat(43),
              rp:{name:"KiCad",id:"localhost"}};
          },
          complete:async()=> "denied" as const
        } as unknown as PgOwnerReadPasskeyRegistration;
        const page=createOwnerPasskeyEnrollmentPageHandler(authority,verify);
        const registration=createOwnerRegistrationHandler(mock,authority,verify);
        server=createServer({
          key:await readFile(key),cert:await readFile(cert)
        },(req,res)=>{void (async()=>{
          if(req.url==="/owner-passkey/register"){
            await page(req,res);return;
          }
          await registration(req,res);
        })().catch(()=>{if(!res.headersSent)res.writeHead(403);res.end();});});
        await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
        const a=server.address();
        assert.ok(a&&typeof a!=="string");
        const port=a.port;
        const trustedCa=await readFile(cert);
        const invoke=(pathname:string,method:"GET"|"POST",
          cookieValue?:string,body?:object,override:Record<string,string>={})=>
          new Promise<{status:number;body:string}>((
            resolve,reject)=>{
            const req=httpsRequest({hostname:"127.0.0.1",port,
              servername:"localhost",ca:trustedCa,method,path:pathname,
              headers:{Host:"localhost",
                ...(cookieValue?{Cookie:cookieValue}:{}),
                ...(method==="POST"?{
                  Origin:authority,"Content-Type":"application/json",
                  "Sec-Fetch-Site":"same-origin"
                }:{}),...override}},res=>{
              const pieces:Buffer[]=[];
              res.on("data",(chunk:Buffer)=>pieces.push(Buffer.from(chunk)));
              res.on("end",()=>resolve({status:res.statusCode??0,
                body:Buffer.concat(pieces).toString("utf8")}));
              res.on("error",reject);
            });
            req.on("error",reject);
            req.end(body?JSON.stringify(body):undefined);
          });
        assert.equal((await invoke("/owner-passkey/register","GET")).status,403);
        assert.equal((await invoke("/owner-passkey/register","GET",
          cookie,undefined,{Host:"spoofed.example.test"})).status,403);
        assert.equal((await invoke("/owner-passkey/register","GET",
          "better-auth.session_token=unsigned")).status,403);
        const opened=await invoke("/owner-passkey/register","GET",cookie);
        assert.equal(opened.status,200);
        assert.ok(opened.body.includes("Register passkey"));
        assert.equal(begins,0,"GET must not begin registration");
        const csrfMatch=opened.body.match(
          /<script id="enrollment" type="application\/json">([^<]+)<\/script>/);
        assert.ok(csrfMatch);
        const session=JSON.parse(csrfMatch[1]) as {csrf:string};
        assert.match(session.csrf,/^[A-Za-z0-9_-]{43}$/);
        const post=(csrf:string,override:Record<string,string>={})=>
          invoke("/owner-passkey/register/begin","POST",cookie,
            {csrf,ownerSub:"attacker",requestId:"attacker"},override);
        assert.equal((await post("wrong-proof")).status,403);
        assert.equal((await post(session.csrf,{
          Origin:"https://attacker.example.test"})).status,403);
        assert.equal((await post(session.csrf,{
          "Sec-Fetch-Site":"cross-site"})).status,403);
        assert.equal((await post(session.csrf,{
          "X-Forwarded-Host":"attacker.example.test"})).status,403);
        assert.equal(begins,0);
        const allowed=await post(session.csrf);
        assert.equal(allowed.status,200);
        const data=JSON.parse(allowed.body) as {requestId:string};
        assert.match(data.requestId,/^[0-9a-f-]{36}$/);
        assert.equal(begins,1,"Only real owner session starts enrollment");
        await db.query('DELETE FROM "session" WHERE "id"=$1',[sessionId]);
        assert.equal((await post(session.csrf)).status,403,
          "Revoked session cannot reuse previously displayed CSRF proof");
        assert.equal(begins,1);
      }finally{
        if(server)await new Promise<void>(r=>server!.close(()=>r()));
        await rm(tmp,{recursive:true,force:true});
      }
    });
  });
