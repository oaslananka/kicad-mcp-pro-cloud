import assert from "node:assert/strict";
import {chromium} from "playwright";
import {renderLanding,renderAccount,renderSignIn} from "../dist/browser-ui.js";
import {renderConnectionsPage} from "../dist/connections-ui.js";
import {renderDevicesPage} from "../dist/devices-ui.js";
import {renderConsentPage} from "../dist/consent-ui.js";
import {uiCss} from "../dist/ui-styles.js";

// Visual/interaction QA for generated HTML without creating any account,
// sharing real user data, or granting OAuth. Browser runs locally only.
const pages={
  home:renderLanding(true),
  account:renderAccount("Demo Engineer"),
  connections:renderConnectionsPage([{id:"local-demo",name:"ChatGPT",clientId:"test-client",
    scopes:["openid","offline_access","projects:read"],csrf:"test-csrf"}]),
  devices:renderDevicesPage([],undefined,false),
  consent:renderConsentPage({kind:"approve",clientName:"ChatGPT",
    scopes:["openid","offline_access","projects:read"],query:"test",csrf:"test-csrf"}),
  signIn:renderSignIn("",["github"])
};
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
  for(const [width,height] of [[1440,900],[768,960],[390,844]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    for(const [kind,html] of Object.entries(pages)){
      await page.setContent(html);
      // Add the first-party CSS separately; never interpolate it into HTML.
      await page.addStyleTag({content:uiCss});
      const metrics=await page.evaluate(()=>({
        fullWidth:document.documentElement.scrollWidth,
        viewport:window.innerWidth,
        title:document.querySelector("h1")?.textContent?.trim(),
        main:document.querySelectorAll("main").length,
        horizontalOverflow:document.documentElement.scrollWidth-window.innerWidth
      }));
      assert.equal(metrics.main,1,`${kind} must have one main landmark`);
      assert.ok(metrics.title?.length,`${kind} must have a page title`);
      assert.ok(metrics.horizontalOverflow<=1,`${kind} overflows at ${width}: ${metrics.horizontalOverflow}px`);
      if(kind==="account"||kind==="connections"||kind==="devices"){
        assert.equal(await page.locator('nav[aria-label="Workspace"] a').count(),3);
        assert.equal(await page.locator('nav[aria-label="Workspace"] a[aria-current="page"]').count(),1);
        const menu=await page.locator('nav[aria-label="Workspace"]').evaluate(el=>({scroll:el.scrollWidth,visible:el.clientWidth}));
        assert.ok(menu.scroll<=menu.visible+1,`${kind} workspace menu clipped at ${width}px`);
      }
      if(kind==="devices"){
        assert.equal(await page.locator('a[href="/devices/pairing"]').count(),0);
        assert.equal(await page.locator('form[action="/devices/revoke"]').count(),0);
      }
      if(kind==="consent"){
        assert.equal(await page.locator('button[value="approve"]').count(),1);
        assert.equal(await page.locator('button[value="deny"]').count(),1);
      }
      if(kind==="signIn")assert.equal(await page.locator('form[action="/auth/start/github"]').count(),1);
      if(process.env.CAPTURE_UI==="1" && ['account','connections','devices','consent','home'].includes(kind)){
        const file=`/tmp/kicad-cloud-${kind}-${width}.jpg`;
        await page.screenshot({path:file,type:"jpeg",quality:80,fullPage:true});
      }
      console.log(`PASS ${kind} ${width}px: ${metrics.title}`);
    }
    await page.close();
  }
} finally {await browser.close();}
