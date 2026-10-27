import type {ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
export type PageKind="home"|"sign-in"|"account"|"consent"|"connections"|"devices"|"notice";
type Props={title:string;eyebrow?:string;summary?:string;kind:PageKind;children:ReactNode;navEnabled?:boolean};
const workspacePages=new Set<PageKind>(["account","connections","devices"]);
function NavLink({href,current,children}:{href:string;current:boolean;children:ReactNode}){
  return <a href={href} aria-current={current?"page":undefined}>{children}</a>;
}
function WorkspaceNav({kind}:{kind:PageKind}){
  return <aside className="workspace-sidebar" aria-label="Workspace navigation">
    <div className="sidebar-label">Workspace</div>
    <nav className="sidebar-links" aria-label="Workspace">
      <NavLink href="/account" current={kind==="account"}><span aria-hidden="true">◫</span> Overview</NavLink>
      <NavLink href="/connections" current={kind==="connections"}><span aria-hidden="true">⟷</span> Connections</NavLink>
      <NavLink href="/devices" current={kind==="devices"}><span aria-hidden="true">▤</span> Devices</NavLink>
    </nav>
    <div className="sidebar-footer"><span className="status-dot" aria-hidden="true"/>
      <strong>Cloud account ready</strong><small>Local KiCad connection not enabled</small>
    </div>
  </aside>;
}
export function renderPage({title,eyebrow,summary,kind,children,navEnabled=true}:Props):string{
  const workspace=workspacePages.has(kind);
  return "<!doctype html>"+renderToStaticMarkup(
    <html lang="en"><head>
      <meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
      <meta name="theme-color" content="#0d1119"/>
      <meta name="description" content="Manage KiCad MCP Cloud connections and access."/>
      <link rel="stylesheet" href="/assets/ui.css"/><title>{title+" — KiCad MCP Cloud"}</title>
    </head><body><div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <header className="site-header"><div className="header-inner">
        <a href="/" className="brand" aria-label="KiCad MCP Cloud home"><span className="brand-mark" aria-hidden="true">K</span>
          <span className="brand-title">KiCad <b>MCP</b><small>Cloud console</small></span></a>
        <div className="header-right">
          <span className="release-label"><span className="status-dot" aria-hidden="true"/> Foundation preview</span>
          {workspace?<a className="header-account" href="/account">My workspace</a>:
            <nav className="public-nav" aria-label="Primary"><NavLink href="/" current={kind==="home"}>Overview</NavLink>
              {navEnabled?<NavLink href="/account" current={false}>Workspace</NavLink>:null}</nav>}
        </div>
      </div></header>
      <main id="main-content" className={"site-main page-"+kind}>
        <div className={workspace?"workspace-layout":"content-wrap"}>
          {workspace?<WorkspaceNav kind={kind}/>:null}
          <div className="main-content">
            <div className="page-heading"><div className="eyebrow">{eyebrow??"KiCad MCP Cloud"}</div>
              <h1>{title}</h1>{summary?<p className="summary">{summary}</p>:null}</div>
            {children}
          </div>
        </div>
      </main>
      <footer className="site-footer"><div className="footer-inner"><span>© KiCad MCP Cloud</span>
        <span>Cloud access available · Local KiCad control not enabled</span></div></footer>
    </div></body></html>
  );
}
export function Landing({identityEnabled}:{readonly identityEnabled:boolean}){
  return <div className="page-stack">
    <section className="card landing-panel" aria-label="Cloud capabilities">
      <div className="landing-intro">
        <span className={identityEnabled?"status-pill ready":"status-pill pending"}>
          {identityEnabled?<span className="status-dot" aria-hidden="true"/>:null}
          {identityEnabled?"Cloud access available":"Account access pending"}</span>
        <h2>Connect your AI client to a controlled workspace.</h2>
        <p>Sign in and manage who can access your cloud account. KiCad project access requires a separate device connection.</p>
        <div className="action-row">{identityEnabled?
          <a className="button primary" href="/sign-in">Open workspace <span aria-hidden="true">→</span></a>:
          <span className="button disabled">Account access pending</span>}
        </div>
      </div>
      <div className="landing-summary" aria-label="Capability status">
        <div><span>01</span><strong>Account &amp; sign-in</strong><small>{identityEnabled?"Available":"Not configured"}</small></div>
        <div><span>02</span><strong>AI client permissions</strong><small>{identityEnabled?"Available":"Not configured"}</small></div>
        <div><span>03</span><strong>Local KiCad connection</strong><small>Not enabled</small></div>
      </div>
    </section>
    <section className="next-section" aria-labelledby="how-it-works"><div className="section-head">
      <h2 id="how-it-works">How access works</h2><p>Three separate approvals keep your projects under your control.</p></div>
      <div className="steps-grid">
        <div className="step"><div className="step-index">01</div><h3>Sign in</h3><p>Use your account to open the cloud console.</p></div>
        <div className="step"><div className="step-index">02</div><h3>Authorize an AI client</h3><p>Review permissions for ChatGPT or another supported client.</p></div>
        <div className="step"><div className="step-index">03 <span className="status-pill pending">Coming later</span></div>
          <h3>Connect KiCad</h3><p>Device pairing and local project actions are not available yet.</p></div>
      </div>
    </section>
  </div>;
}
export function Notice({message}:{readonly message:string}){
  return <section className="card detail-card"><div className="notice-icon" aria-hidden="true">!</div>
    <h2>We couldn't complete that action</h2><p>{message}</p>
    <a href="/" className="text-link">Return to overview →</a></section>;
}
export function SignIn({query,providers}:{readonly query:string;readonly providers:ReadonlyArray<"google"|"github">}){
  return <section className="card auth-card">
    <div className="panel-heading"><div className="panel-icon" aria-hidden="true">↗</div>
      <div><h2>Sign in to KiCad MCP Cloud</h2><p>Choose the account you want to use for cloud access.</p></div></div>
    <div className="providers">{providers.includes("google")&&<form action="/auth/start/google" method="post">
      <input type="hidden" name="oauth_query" value={query}/><button className="button provider" type="submit"><span className="provider-logo">G</span> Continue with Google <span className="arrow" aria-hidden="true">→</span></button>
    </form>}{providers.includes("github")&&<form action="/auth/start/github" method="post">
      <input type="hidden" name="oauth_query" value={query}/><button className="button provider" type="submit"><span className="provider-logo github">GH</span> Continue with GitHub <span className="arrow" aria-hidden="true">→</span></button>
    </form>}</div>
    <p className="auth-footnote">Signing in does not share your KiCad projects. AI clients and project access are approved separately.</p>
  </section>;
}
export function Account({name}:{readonly name:string}){
  return <div className="page-stack">
    <section className="card account-card" aria-label="Account status">
      <div className="account-banner"><span className="avatar" aria-hidden="true">{name.trim().slice(0,1).toUpperCase()||"U"}</span>
        <div><div className="status-pill ready"><span className="status-dot" aria-hidden="true"/> Signed in</div>
          <h2>{name}</h2><p>Your cloud account is ready to manage client permissions.</p></div></div>
    </section>
    <section className="dashboard-grid" aria-label="Workspace features">
      <article className="card dashboard-card"><div className="dashboard-card-top"><span className="feature-icon" aria-hidden="true">⟷</span><span className="status-pill ready">Available</span></div>
        <h2>AI connections</h2><p>See which apps you've authorized, review their permissions, or remove access.</p>
        <a className="button secondary" href="/connections">Manage connections <span aria-hidden="true">→</span></a>
      </article>
      <article className="card dashboard-card"><div className="dashboard-card-top"><span className="feature-icon" aria-hidden="true">▤</span><span className="status-pill pending">Not enabled</span></div>
        <h2>Devices</h2><p>Device enrollment and local KiCad execution are not available on this deployment.</p>
        <a className="button secondary" href="/devices">View device status <span aria-hidden="true">→</span></a>
      </article>
    </section>
    <section className="card next-steps"><div><div className="card-kicker">WORKSPACE STATUS</div>
      <h2>What can I do now?</h2><p>You can authorize AI clients and control their account permissions. Device pairing and project access come later.</p></div>
      <div className="status-list"><div><span className="status-dot" aria-hidden="true"/><span>Cloud account</span><b>Ready</b></div>
        <div><span className="status-dot" aria-hidden="true"/><span>AI client authorization</span><b>Available</b></div>
        <div className="pending"><span className="status-dot" aria-hidden="true"/><span>KiCad device execution</span><b>Not enabled</b></div></div>
    </section>
  </div>;
}
