import assert from "node:assert/strict";
import { chromium } from "playwright";

// Browser-verified native form POST; synthetic fetch/curl cannot detect
// Referrer-Policy no-referrer turning Chrome's form Origin into null.
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
try {
  const page=await browser.newPage();
  const destination="https://kicad-mcp-pro.oaslananka.dev/sign-in";
  const response=await page.goto(destination,{waitUntil:"domcontentloaded",timeout:20000});
  assert.equal(response?.status(),200);
  assert.equal(response.headers()["referrer-policy"],"same-origin");
  const formPost=page.waitForResponse(reply=>reply.url()==="https://kicad-mcp-pro.oaslananka.dev/auth/start/github" && reply.request().method()==="POST",{timeout:25000});
  await page.getByRole("button",{name:/Continue with GitHub/}).click({noWaitAfter:true});
  const result=await formPost;
  assert.equal(result.status(),303,"Native Chrome POST must start GitHub OAuth, not return 403 or 502");
  assert.match(result.headers()["location"]??"",/^https:\/\/github\.com\//);
  console.log("Real Chromium form POST PASS: 303 to GitHub (without completing OAuth)");
} finally {
  await browser.close();
}
