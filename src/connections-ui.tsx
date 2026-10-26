import {renderPage} from "./ui-shell.js";
export type DisplayConnection={id:string;name:string;scopes:string[];clientId:string;csrf:string};
export function renderConnectionsPage(connections:DisplayConnection[],notice?:string):string {
  return renderPage({title:"Your AI connections.",kind:"connections",eyebrow:"ACCESS MANAGEMENT",
    summary:"Review connected clients and remove access when you no longer need it.",
    children:<section className="card detail-card">
      <div className="card-kicker">APPROVED CLIENTS</div>
      {notice?<output className="output-notice">{notice}</output>:null}
      {connections.length===0?<p>No active OAuth consents.</p>:
        <ul className="connections-list">{connections.map(c=><li className="connection-item" key={c.id}>
          <div><h3>{c.name}</h3><p>Requested scopes: {c.scopes.join(", ")}</p></div>
          <form method="post" action="/connections/revoke">
            <input type="hidden" name="id" value={c.id}/>
            <input type="hidden" name="client_id" value={c.clientId}/>
            <input type="hidden" name="csrf" value={c.csrf}/>
            <button className="button danger" type="submit">Remove access</button>
          </form>
        </li>)}</ul>}
      <div className="security-note"><span aria-hidden="true">◇</span>{" "}
        Removing access disables all project grants for the client. Existing JWTs may remain cryptographically valid until expiry, but revoked grants prevent project discovery.
      </div>
      <a className="mini-link" href="/account">← Back to account</a>
    </section>});
}
