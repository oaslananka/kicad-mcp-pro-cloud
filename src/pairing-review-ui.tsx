import {renderPage} from "./ui-shell.js";
export function renderPairingReviewPage(csrf:string,notice?:string):string {
  return renderPage({title:"Approve a device.",kind:"devices",eyebrow:"DEVICE PAIRING",
    summary:"Only approve a device you physically control. Check its identifier and code on the local device.",
    children:<section className="card detail-card">
      <div className="card-kicker">PENDING PAIRING REVIEW</div>
      {notice?<output className="output-notice">{notice}</output>:null}
      <form action="/devices/pairing/review" method="post">
        <label>Pairing challenge ID
          <input name="challenge_id" required={true} maxLength={36} autoComplete="off"/>
        </label>
        <label>12-character device code
          <input name="user_code" required={true} minLength={12} maxLength={20} autoComplete="off"/>
        </label>
        <input type="hidden" name="csrf" value={csrf}/>
        <div className="action-row">
          <button className="button primary" name="decision" value="approve" type="submit">Approve this device</button>
          <button className="button danger" name="decision" value="deny" type="submit">Deny pairing</button>
        </div>
      </form>
      <div className="security-note">The code alone does not grant access. The device must also prove
        possession of its own Ed25519 private key. Enrolled devices remain disabled until separately authorized.
        Never approve an unexpected code.</div>
      <a className="mini-link" href="/devices">← Your devices</a>
    </section>});
}
