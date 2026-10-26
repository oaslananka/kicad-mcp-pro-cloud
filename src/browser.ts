import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import type { Identity } from "./identity.js";

export type BrowserIdentity = Pick<Identity,"handler"> & Partial<Pick<Identity,"$context"|"api">>;
const htmlHeaders = {
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"
};

function escape(value: string): string {
  return value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] ?? c));
}
function page(title:string,content:string,status=200):Response {
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
    +escape(title)+'</title><main><h1>'+escape(title)+'</h1>'+content+'</main></html>';
  return new Response(html,{status,headers:htmlHeaders});
}
async function checkedOAuthQuery(identity:BrowserIdentity,signed:string):Promise<boolean> {
  if (!identity.$context || signed.length>8192) return false;
  const {secret}=await identity.$context;
  return verifyOAuthQueryParams(signed,secret);
}
function providerForm(provider:"google"|"github",signed:string):string {
  return '<form method="post" action="/auth/start/'+provider+'"><input type="hidden" name="oauth_query" value="'+escape(signed)+'"><button type="submit">Continue with '+(provider==="google"?"Google":"GitHub")+'</button></form>';
}

export async function browserResponse(request:Request, identity:BrowserIdentity, publicOrigin:string):Promise<Response|null> {
  const url=new URL(request.url);
  if (url.pathname==="/sign-in" && request.method==="GET") {
    const signed=url.search.slice(1);
    if(signed && !(await checkedOAuthQuery(identity,signed))) {
      return page("Invalid or expired authorization request","<p>Restart the connection from your AI client.</p>",400);
    }
    return page("Sign in to KiCad MCP Pro",
      "<p>Only approved local KiCad projects can be shared with AI clients.</p>"+
      providerForm("google",signed)+providerForm("github",signed));
  }
  const entry=/^\/auth\/start\/(google|github)$/.exec(url.pathname);
  if(entry && request.method==="POST") {
    if(request.headers.get("origin")!==publicOrigin) return page("Forbidden","<p>Start from the sign-in page.</p>",403);
    if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/x-www-form-urlencoded"){
      return page("Unsupported request","<p>Invalid sign-in request.</p>",415);
    }
    const raw=await request.text();
    if(raw.length>8192) return page("Invalid request","<p>Request too large.</p>",413);
    const fields=new URLSearchParams(raw);
    if(Array.from(fields.keys()).length!==1 || !fields.has("oauth_query")){
      return page("Invalid request","<p>Unexpected login fields.</p>",400);
    }
    const signed=fields.get("oauth_query")??"";
    if(signed && !(await checkedOAuthQuery(identity,signed))){
      return page("Invalid authorization request","<p>Restart the connection from your AI client.</p>",400);
    }
    const provider=entry[1] as "google"|"github";
    const authResponse=await identity.handler(new Request(publicOrigin+"/api/auth/sign-in/social",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Origin":publicOrigin,
        ...(request.headers.get("cookie")?{"Cookie":request.headers.get("cookie")!}:{})
      },
      body:JSON.stringify({provider,callbackURL:publicOrigin+"/account",...(signed?{oauth_query:signed}:{})})
    }));
    if(!authResponse.ok) return page("Sign-in unavailable","<p>Unable to start provider authentication.</p>",502);
    const payload:unknown=await authResponse.json();
    if(!payload || typeof payload!=="object" || !("url" in payload) || typeof payload.url!=="string"){
      return page("Sign-in unavailable","<p>Missing provider authorization URL.</p>",502);
    }
    let next:URL;
    try{next=new URL(payload.url);}catch{return page("Sign-in unavailable","<p>Invalid provider URL.</p>",502);}
    const expected=provider==="google"?"accounts.google.com":"github.com";
    if(next.protocol!=="https:" || next.hostname!==expected){
      return page("Sign-in unavailable","<p>Unapproved provider destination.</p>",502);
    }
    const headers=new Headers({"Location":next.href,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"});
    for(const cookie of authResponse.headers.getSetCookie()) headers.append("Set-Cookie",cookie);
    return new Response(null,{status:303,headers});
  }
  if(url.pathname==="/account" && request.method==="GET"){
    const session=await identity.api?.getSession({headers:request.headers});
    if(!session?.user) return new Response(null,{status:303,headers:{"Location":"/sign-in","Cache-Control":"no-store"}});
    return page("KiCad MCP Pro Account",
      "<p>Signed in as "+escape(session.user.name??"User")+".</p>"+
      "<p>Cloud device enrollment and project management are not yet available.</p>");
  }
  return null;
}
