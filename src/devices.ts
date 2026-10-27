import {randomBytes,timingSafeEqual} from "node:crypto";
import {makeSignature} from "better-auth/crypto";
import type {BrowserIdentity} from "./browser.js";
import type {PgDeviceManagement} from "./device-management.js";
import {renderDevicesPage} from "./devices-ui.js";

export type DeviceManagementPort=Pick<PgDeviceManagement,"list"|"revokeDevice">;
const FIVE_MINUTES=300_000;
const DEVICE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function cookieName(origin:string):string{
  return origin.startsWith("https://")?"__Host-kicad-devices":"kicad-devices";
}
function cookie(value:string,origin:string,age:number):string{
  return cookieName(origin)+"="+value+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+age+
    (origin.startsWith("https://")?"; Secure":"");
}
function readCookie(req:Request,origin:string):string|null{
  const name=cookieName(origin);
  return (req.headers.get("cookie")??"").split(";").map(x=>x.trim())
    .find(x=>x.startsWith(name+"="))?.slice(name.length+1)??null;
}
function reply(status:number,devices:Parameters<typeof renderDevicesPage>[0]=[],
  message?:string,stateCookie?:string,enrollmentAvailable=true):Response{
  const response=new Response(renderDevicesPage(devices,message,enrollmentAvailable),{status,headers:{
    "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store",
    "Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
    "Content-Security-Policy":"default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self'"
  }});
  if(stateCookie)response.headers.append("Set-Cookie",stateCookie);
  return response;
}
function error(status:number):Response{
  return reply(status,[],"Device management is temporarily unavailable.",undefined,false);
}
function pendingSchema(error:unknown):boolean{
  return Boolean(error && typeof error==="object" && "code" in error &&
    error.code==="42P01" && "message" in error &&
    typeof error.message==="string" && error.message.includes('"device_credentials"'));
}
function userOf(session:Awaited<ReturnType<NonNullable<BrowserIdentity["api"]>["getSession"]>>){
  if(!session?.user?.id||!session.session?.id)return null;
  return {user:session.user.id,session:session.session.id};
}
async function signature(secret:string,user:string,session:string,deviceId:string,stamp:string,nonce:string){
  const value=JSON.stringify(["device-revoke-v1",user,session,deviceId,stamp,nonce]);
  return Buffer.from(await makeSignature(value,secret),"base64").toString("base64url");
}
async function csrf(secret:string,user:string,session:string,deviceId:string,stamp:string,nonce:string){
  return stamp+"."+nonce+"."+(await signature(secret,user,session,deviceId,stamp,nonce));
}
async function checkCsrf(req:Request,origin:string,secret:string,
  owner:{user:string;session:string},id:string,sent:string):Promise<boolean>{
  if(sent.length>250||!readCookie(req,origin))return false;
  const [stamp,nonce,sig,...rest]=sent.split(".");
  if(rest.length||!/^\d{13}$/.test(stamp)||
    !/^[a-zA-Z0-9_-]{22}$/.test(nonce)||!/^[a-zA-Z0-9_-]{43}$/.test(sig))return false;
  if(readCookie(req,origin)!==stamp+"."+nonce)return false;
  const now=Date.now(),created=Number(stamp);
  if(created>now+5000||now-created>FIVE_MINUTES)return false;
  const a=Buffer.from(await signature(secret,owner.user,owner.session,id,stamp,nonce));
  const b=Buffer.from(sig);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function list(req:Request,identity:BrowserIdentity,origin:string,
  devices:DeviceManagementPort):Promise<Response>{
  if(!identity.api||!identity.$context)return error(503);
  const who=userOf(await identity.api.getSession({headers:req.headers}));
  if(!who)return new Response(null,{status:303,headers:{"Location":"/sign-in","Cache-Control":"no-store"}});
  let list:Awaited<ReturnType<DeviceManagementPort["list"]>>;
  try{list=await devices.list(who.user);}
  catch(cause){
    // Production intentionally remains below device-credential migration 008.
    // Show a clearly disabled page; never claim an empty live inventory.
    if(pendingSchema(cause))return reply(200,[],undefined,undefined,false);
    return error(503);
  }
  const {secret}=await identity.$context;
  const stamp=String(Date.now()),nonce=randomBytes(16).toString("base64url");
  const rows=await Promise.all(list.map(async d=>({...d,
    csrf:await csrf(secret,who.user,who.session,d.id,stamp,nonce)})));
  const note=new URL(req.url).searchParams.has("revoked")?
    "Device key revoked; its sessions and associated project/client permissions were disabled.":undefined;
  return reply(200,rows,note,cookie(stamp+"."+nonce,origin,300));
}
async function revoke(req:Request,identity:BrowserIdentity,origin:string,
  devices:DeviceManagementPort):Promise<Response>{
  if(!identity.api||!identity.$context)return error(503);
  if(req.headers.get("origin")!==origin)return error(403);
  if(req.headers.get("content-type")?.split(";")[0].trim()!=="application/x-www-form-urlencoded")
    return error(415);
  const raw=await req.text();
  if(raw.length>2048)return error(413);
  const fields=new URLSearchParams(raw);
  if(Array.from(fields.keys()).length!==2||
    fields.getAll("device_id").length!==1||fields.getAll("csrf").length!==1)return error(400);
  const id=fields.get("device_id")??"",proof=fields.get("csrf")??"";
  if(!DEVICE_ID.test(id))return error(400);
  const who=userOf(await identity.api.getSession({headers:req.headers}));
  if(!who)return error(401);
  const {secret}=await identity.$context;
  if(!await checkCsrf(req,origin,secret,who,id,proof))return error(403);
  let success:boolean;
  try{success=await devices.revokeDevice(who.user,id);}
  catch{return error(503);}
  if(!success)return error(404);
  return new Response(null,{status:303,headers:{
    "Location":"/devices?revoked=1","Cache-Control":"no-store",
    "Set-Cookie":cookie("",origin,0)
  }});
}
/** Authenticated browser-only management, never usable in external auth mode. */
export async function devicesResponse(req:Request,identity:BrowserIdentity,origin:string,
  devices?:DeviceManagementPort):Promise<Response|null>{
  const path=new URL(req.url).pathname;
  if(path!=="/devices"&&path!=="/devices/revoke")return null;
  if(!devices)return error(503);
  if(path==="/devices"&&req.method==="GET")return list(req,identity,origin,devices);
  if(path==="/devices/revoke"&&req.method==="POST")return revoke(req,identity,origin,devices);
  return error(405);
}
