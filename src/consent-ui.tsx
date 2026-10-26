import {renderPage} from "./ui-shell.js";

export type ConsentView =
  | {kind:"notice";message:string}
  | {kind:"approve";clientName:string;scopes:string[];claims?:string;query:string;csrf:string};

export function renderConsentPage(view:ConsentView):string {
  if(view.kind==="notice") {
    return renderPage({title:"Authorization unavailable.",kind:"notice",
      eyebrow:"REQUEST VERIFICATION",
      children:<section className="card detail-card"><p>{view.message}</p>
        <a href="/" className="mini-link">Back to overview ↗</a></section>});
  }
  return renderPage({title:"Review access.",kind:"consent",
    eyebrow:"SECURE OAUTH AUTHORIZATION",
    summary:"Only approve clients and permissions you recognize.",
    children:<section className="card detail-card">
      <div className="card-kicker">REQUESTED BY YOUR AI CLIENT</div>
      <h2>{view.clientName}</h2>
      <p className="field-help">This client requests access to your account with these permissions:</p>
      <ul className="scope-list">{Array.from(new Set(view.scopes)).map(scope=><li key={scope}>{scope}</li>)}</ul>
      {view.claims?<p className="field-help">Additional claims requested: {view.claims}</p>:null}
      <div className="security-note"><span aria-hidden="true">◇</span>
        This does not automatically authorize access to any KiCad project. Project grants are separate.
      </div>
      <form action="/consent" method="post">
        <input type="hidden" name="oauth_query" value={view.query}/>
        <input type="hidden" name="csrf" value={view.csrf}/>
        <div className="form-actions">
          <button className="button reject" name="decision" value="deny" type="submit">Deny</button>
          <button className="button primary" name="decision" value="approve" type="submit">Approve access ↗</button>
        </div>
      </form>
    </section>});
}
