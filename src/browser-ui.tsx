import {renderPage,Landing,SignIn,Account,Notice} from "./ui-shell.js";
export function renderLanding(identityEnabled:boolean){
  return renderPage({title:"Engineering, connected.",kind:"home",navEnabled:identityEnabled,eyebrow:"YOUR DESIGN. YOUR CONTROL.",
    summary:"A secure AI bridge for KiCad workflows — transparent permissions, local project ownership, and a modern connected experience.",
    children:<Landing identityEnabled={identityEnabled}/>});
}
export function renderSignIn(
  query:string,providers:ReadonlyArray<"google"|"github">=["google","github"]
){
  return renderPage({title:"Make the connection.",kind:"sign-in",eyebrow:"AUTHORIZED ACCESS",
    summary:"A seamless sign-in for a controlled, local-first engineering workflow.",children:<SignIn query={query} providers={providers}/>});
}
export function renderAccount(name:string){
  return renderPage({title:"Your workspace.",kind:"account",eyebrow:"ACCOUNT OVERVIEW",
    summary:"Manage your trusted AI connections and account access.",children:<Account name={name}/>});
}
export function renderNotice(title:string,message:string){
  return renderPage({title,kind:"notice",eyebrow:"ACCOUNT SECURITY",children:<Notice message={message}/>});
}
