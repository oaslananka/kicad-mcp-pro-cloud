import {renderPage} from "./ui-shell.js";
import type {ManagedDevice} from "./device-management.js";

export function renderDevicesPage(
  devices:ReadonlyArray<ManagedDevice & {csrf:string}>,
  notice?:string
):string {
  return renderPage({
    title:"Your trusted devices.",kind:"devices",eyebrow:"DEVICE SECURITY",
    summary:"Review enrolled devices. Revocation permanently blocks the device credential and disables its projects and client grants.",
    children:<section className="card detail-card">
      <div className="card-kicker">ENROLLED DEVICES</div>
      {notice?<output className="output-notice">{notice}</output>:null}
      {devices.length===0?<p>No enrolled devices. Secure device onboarding is not enabled yet.</p>:
        <ul className="connections-list">{devices.map(d=>
          <li className="connection-item" key={d.id}>
            <div>
              <h3>{d.alias}</h3>
              <p>Credential: {d.fingerprint.slice(0,16)}…</p>
              <p>{d.revoked?"Revoked":d.enabled?"Enabled (not proof of online status)":"Disabled"}</p>
            </div>
            {d.revoked?<span>Credential revoked</span>:
              <form action="/devices/revoke" method="post">
                <input type="hidden" name="device_id" value={d.id}/>
                <input type="hidden" name="csrf" value={d.csrf}/>
                <button className="button danger" type="submit">Revoke device</button>
              </form>}
          </li>)}</ul>}
      <div className="security-note">Revoked keys cannot authenticate, even if a device flag is later changed.
        No KiCad project files or paths are stored in Cloud.</div>
      <div className="action-row"><a className="button secondary" href="/devices/pairing">Review device pairing ↗</a></div>
      <a className="mini-link" href="/account">← Back to account</a>
    </section>
  });
}
