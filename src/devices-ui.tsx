import {renderPage} from "./ui-shell.js";
import type {ManagedDevice} from "./device-management.js";
export function renderDevicesPage(devices:ReadonlyArray<ManagedDevice & {csrf:string}>,notice?:string,enrollmentAvailable=true):string {
  return renderPage({title:"Devices",kind:"devices",eyebrow:"Workspace / Devices",
    summary:"Device availability and access management for local KiCad integrations.",
    children:<div className="page-stack"><section className="card detail-card">
      {notice?<output className="output-notice">{notice}</output>:null}
      {!enrollmentAvailable?<div className="status-card"><div>
        <span className="status-pill pending">Not enabled</span>
        <h2>Local KiCad devices aren't available yet</h2>
        <p>Device enrollment and management are not enabled on this deployment. No pairing or local project control is available. The device schema and recovery checks must be approved before activation.</p>
        <div className="state-detail"><div><span>Cloud account</span><small>Available</small></div>
          <div><span>Device enrollment</span><small>Not enabled</small></div>
          <div><span>Remote KiCad execution</span><small>Not enabled</small></div></div>
      </div></div>:
        <><div className="card-kicker">ENROLLED DEVICES</div>
          <h2>{devices.length===1?"1 enrolled device":`${devices.length} enrolled devices`}</h2>
          {devices.length===0?<div className="empty-state"><div className="empty-icon" aria-hidden="true">▤</div><div>
            <h3>No enrolled devices</h3><p>No devices are currently registered to this account.</p>
          </div></div>:
            <ul className="connections-list">{devices.map(d=><li className="connection-item" key={d.id}>
              <div><h3>{d.alias}</h3><p>Credential fingerprint: {d.fingerprint.slice(0,16)}…</p>
                <p>{d.revoked?"Revoked":d.enabled?"Enabled (not proof of online status)":"Disabled"}</p></div>
              {d.revoked?<span className="status-pill pending">Credential revoked</span>:
                <form action="/devices/revoke" method="post">
                  <input type="hidden" name="device_id" value={d.id}/><input type="hidden" name="csrf" value={d.csrf}/>
                  <button className="button danger" type="submit">Revoke device</button>
                </form>}
            </li>)}</ul>}
          <div className="security-note">Revoked keys cannot authenticate, even if a device flag is later changed. No KiCad project files or paths are stored in Cloud.</div>
          <div className="action-row"><a className="button secondary" href="/devices/pairing">Review device pairing →</a></div>
        </>}
    </section></div>
  });
}
