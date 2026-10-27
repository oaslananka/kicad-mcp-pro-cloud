import type {ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
export type PageKind="home"|"sign-in"|"account"|"consent"|"connections"|"devices"|"notice";
type Props={title:string;eyebrow?:string;summary?:string;kind:PageKind;children:ReactNode;navEnabled?:boolean};
export function renderPage({title,eyebrow,summary,kind,children,navEnabled=true}:Props):string{
  return "<!doctype html>"+renderToStaticMarkup(
    <html lang="en"><head>
      <meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
      <meta name="theme-color" content="#0a1119"/>
      <meta name="description" content="Local-first KiCad engineering with authorized AI workflows."/>
      <link rel="stylesheet" href="/assets/ui.css"/><title>{title + " — KiCad MCP Cloud"}</title>
    </head><body><div className="app-shell">
      <header className="site-header"><div className="header-inner">
        <a href="/" className="brand"><span className="brand-mark" aria-hidden="true">K<span>.</span></span>
          <span>KiCad <b>MCP</b> <small>CLOUD</small></span></a>
        <nav aria-label="Primary"><a href="/" aria-current={kind==="home"?"page":undefined}>Overview</a>
          {navEnabled?<><a href="/account" aria-current={kind==="account"?"page":undefined}>Workspace</a>
          <a href="/connections" aria-current={kind==="connections"?"page":undefined}>Connections</a>
          <a href="/devices" aria-current={kind==="devices"?"page":undefined}>Devices</a></>:
          <span className="nav-disabled">Account access pending</span>}</nav>
        <div className="header-state"><i aria-hidden="true"/> LOCAL-FIRST PLATFORM</div>
      </div></header>
      <main className={"site-main page-"+kind}><div className="content-wrap">
        <div className="hero-heading"><div className="eyebrow"><span aria-hidden="true"/> {eyebrow??"SECURE ENGINEERING WORKSPACE"}</div>
          <h1>{title}</h1>{summary?<p className="summary">{summary}</p>:null}</div>
        {children}
      </div></main>
      <footer><div className="footer-inner"><span>KiCad MCP Cloud <span className="muted">/</span> Engineering infrastructure</span>
        <span>Project files stay on your device</span></div></footer>
    </div></body></html>
  );
}
export function Landing({identityEnabled}:{readonly identityEnabled:boolean}){
  return <div className="page-stack">
    <div className="feature-grid"><section className="card spotlight">
      <div className="card-kicker"><b>01</b> ENGINEERING WORKSPACE</div>
      <h2>From intelligent assistance to real PCB workflows.</h2>
      <p>Connect authorized AI clients to carefully scoped KiCad capabilities — with privacy and control designed in.</p>
      <div className="action-row">{identityEnabled?
        <a className="button primary" href="/sign-in">Open workspace <span aria-hidden="true">↗</span></a>:
        <span className="button disabled">Account access pending</span>}
        <a className="button secondary" href="/health">Service status <span aria-hidden="true">↗</span></a>
      </div><div className="highlight-line"/>
    </section><div className="card-stack">
      <section className="card small-card"><div className="card-kicker">SECURITY BY DESIGN</div>
        <span className="symbol" aria-hidden="true">◎</span><h3>Explicit permissions</h3>
        <p>Account consent never silently authorizes access to a KiCad project.</p></section>
      <section className="card small-card accent-card"><div className="card-kicker">ENGINEERING CONTROL</div>
        <h3>Local project ownership.</h3>
        <p>Project files remain on your device. Remote execution requires a separate approved connector.</p></section>
    </div></div>
    <div className="section-label">BUILT FOR CONTROLLED AI WORKFLOWS <span/></div>
    <div className="three-cols"><div><b>01 /</b><h3>Remote MCP</h3><p>Securely exposed workflow-level AI tools.</p></div>
      <div><b>02 /</b><h3>Scoped consent</h3><p>Approve and revoke individual AI connections.</p></div>
      <div><b>03 /</b><h3>Local-first</h3><p>Device pairing and live KiCad execution are upcoming.</p></div></div>
  </div>;
}
export function Notice({message}:{readonly message:string}){
  return <section className="card detail-card"><div className="notice-icon">!</div><p>{message}</p>
    <a href="/" className="text-link">Return to overview ↗</a></section>;
}
export function SignIn({query,providers}:{
  readonly query:string;
  readonly providers:ReadonlyArray<"google"|"github">
}){
  return <section className="card auth-card">
    <div className="panel-heading"><span className="panel-icon" aria-hidden="true">✳</span>
      <div><h2>Welcome to your workspace</h2><p>Choose a trusted identity provider to continue.</p></div></div>
    <div className="providers">{providers.includes("google")&&<form action="/auth/start/google" method="post">
      <input type="hidden" name="oauth_query" value={query}/><button className="button provider" type="submit"><span className="provider-logo">G</span> Continue with Google <span className="arrow" aria-hidden="true">↗</span></button>
    </form>}{providers.includes("github")&&<form action="/auth/start/github" method="post">
      <input type="hidden" name="oauth_query" value={query}/><button className="button provider" type="submit"><span className="provider-logo github">GH</span> Continue with GitHub <span className="arrow" aria-hidden="true">↗</span></button>
    </form>}</div>
    <div className="security-note"><span aria-hidden="true">◇</span> Sign-in never automatically shares your KiCad designs. Project access is authorized separately.</div>
  </section>;
}
export function Account({name}:{readonly name:string}){
  return <div className="page-stack"><section className="card detail-card">
    <div className="account-banner"><span className="avatar">{name.trim().slice(0,1).toUpperCase()||"U"}</span>
      <div><div className="card-kicker">SIGNED IN WORKSPACE</div><h2>Welcome back, {name}</h2>
        <p>Manage the AI clients authorized to use your account.</p></div></div>
    <div className="action-row"><a className="button primary" href="/connections">Manage AI connections ↗</a>
      <a className="button secondary" href="/devices">Manage devices ↗</a></div>
  </section><section className="card future-card"><div className="card-kicker">COMING TO YOUR WORKSPACE</div>
    <h3>Device pairing &amp; project registry</h3>
    <p>Cloud device enrollment and project management are not yet available. Live KiCad access will require explicit approval.</p>
  </section></div>;
}
