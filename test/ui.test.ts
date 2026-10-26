import assert from "node:assert/strict";
import {test} from "node:test";
import {renderConsentPage} from "../src/consent-ui.js";
import {renderConnectionsPage} from "../src/connections-ui.js";
import {renderLanding,renderAccount,renderSignIn} from "../src/browser-ui.js";
import {uiCss} from "../src/ui-styles.js";

test("production landing is a modern, honest local-first interface",()=>{
  const page=renderLanding(false);
  assert.match(page,/Engineering, connected/);
  assert.match(page,/Account access pending/);
  assert.doesNotMatch(page,/href="\/sign-in"/);
  assert.match(page,/Remote execution requires a separate approved connector/);
  assert.match(page,/rel="stylesheet" href="\/assets\/ui.css"/);
  assert.doesNotMatch(page,/<script[\s>]/i);
  assert.match(uiCss,/@media\(max-width:650px\)/);
  assert.match(uiCss, /prefers-reduced-motion/);
  const open=renderLanding(true);
  assert.match(open,/href="\/sign-in"/);
});
test("sign-in presents both providers without altering signed parameters",()=>{
  const value="client_id=trusted%26scope=openid%20projects%3Aread";
  const page=renderSignIn(value);
  assert.match(page,/Continue with Google/);
  assert.match(page,/Continue with GitHub/);
  assert.match(page,/action="\/auth\/start\/google"/);
  assert.match(page,/action="\/auth\/start\/github"/);
  assert.match(page,/name="oauth_query"/);
  assert.match(page,/client_id=trusted%26scope=openid/);
  assert.doesNotMatch(page,/<script[\s>]/i);
});
test("user, client and scope content cannot inject HTML into premium pages",()=>{
  const attack='<script>alert("x")</script>';
  const account=renderAccount(attack);
  const consent=renderConsentPage({kind:"approve",clientName:attack,
    scopes:[attack,"projects:read"],query:"q&a",csrf:"csrf"});
  const connections=renderConnectionsPage([{
    id:"fixture",name:attack,scopes:[attack],clientId:"fixture-client",csrf:"csrf"
  }]);
  for(const page of [account,consent,connections]){
    assert.doesNotMatch(page,/<script[\s>]/i);
    assert.match(page,/&lt;script&gt;/);
    assert.match(page,/href="\/assets\/ui.css"/);
  }
  assert.match(consent,/name="oauth_query" value="q&amp;a"/);
  assert.match(consent,/value="approve"/);
  assert.match(consent,/value="deny"/);
  assert.match(connections,/action="\/connections\/revoke"/);
});
