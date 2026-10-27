import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync,spawnSync} from "node:child_process";
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {dirname,resolve,join} from "node:path";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const base={PATH:process.env.PATH,
  PUBLIC_ORIGIN:"https://pcb.example.test",
  OAUTH_ISSUER:"https://pcb.example.test/api/auth",
  OAUTH_JWKS_URL:"https://pcb.example.test/api/auth/jwks",
  OAUTH_AUDIENCE:"https://pcb.example.test/mcp",
  KICAD_DB_PASSWORD:"not-a-secret-test-fixture",
  AUTH_MODE:"builtin",BETTER_AUTH_SECRET:"not-a-secret-test-fixture",
  GITHUB_CLIENT_ID:"sample-id",GITHUB_CLIENT_SECRET:"not-a-secret-test-fixture",
  KICAD_TUNNEL_NETWORK:"pcb_dedicated_ingress",
  CLOUDFLARE_TUNNEL_TOKEN:"not-a-secret-test-fixture"};
const cli=(action,updates={})=>spawnSync(process.execPath,["scripts/portable-config.mjs",action],
  {cwd:root,env:{...base,...updates},encoding:"utf8"});
test("public target and dedicated network are validated without printing secrets",()=>{
  assert.equal(cli("origin").stdout.trim(),base.PUBLIC_ORIGIN);
  assert.equal(cli("network").stdout.trim(),base.KICAD_TUNNEL_NETWORK);
  assert.equal(cli("google").stdout.trim(),"false");
  assert.equal(cli("google",{GOOGLE_CLIENT_ID:"google-test",GOOGLE_CLIENT_SECRET:"dummy"}).stdout.trim(),"true");
  const result=cli("validate");
  assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(result.stdout, /not-a-secret-test-fixture/);
});
test("fail closed on unsafe or inconsistent deployment config",()=>{
  for(const delta of [
    {PUBLIC_ORIGIN:"http://pcb.example.test"},
    {PUBLIC_ORIGIN:"https://pcb.example.test/with-path"},
    {PUBLIC_ORIGIN:"https://user:pass@pcb.example.test"},
    {OAUTH_AUDIENCE:"https://another.example/mcp"},
    {OAUTH_ISSUER:"https://another.example/api/auth"},
    {KICAD_DB_PASSWORD:""},
    {GITHUB_CLIENT_SECRET:""},
    {GOOGLE_CLIENT_ID:"partial-google"},
    {KICAD_TUNNEL_NETWORK:"bad network/name"},
    {CONNECTOR_WS_ENABLED:"true"},
    {PAIRING_DEVICE_API_ENABLED:"true"}
  ]) {
    const out=cli("validate",delta);
    assert.notEqual(out.status,0,JSON.stringify(Object.keys(delta)));
    assert.doesNotMatch(out.stderr,/not-a-secret-test-fixture/);
  }
});
test("production compose accepts configurable external network and forwards management config",()=>{
  const output=execFileSync("docker",["compose","-f","infra/compose.production.yml","config","--format","json"],
    {cwd:root,env:{...base,MANAGEMENT_CLIENT_ID:"owner-ui",ALLOWED_ORIGINS:base.PUBLIC_ORIGIN},encoding:"utf8"});
  const config=JSON.parse(output);
  assert.equal(config.networks.tunnel.name,base.KICAD_TUNNEL_NETWORK);
  assert.equal(config.networks.tunnel.external,true);
  assert.equal(config.services.app.environment.MANAGEMENT_CLIENT_ID,"owner-ui");
  assert.equal(config.services.app.environment.ALLOWED_ORIGINS,base.PUBLIC_ORIGIN);
  assert.equal(config.services.app.ports,undefined);
});
test("managed Cloudflare tunnel is opt-in, bound to dedicated network and publishes no ports",()=>{
  const output=execFileSync("docker",["compose","-f","infra/compose.cloudflare.yml","config","--format","json"],
    {cwd:root,env:base,encoding:"utf8"});
  const config=JSON.parse(output);
  assert.equal(config.networks.ingress.external,true);
  assert.equal(config.networks.ingress.name,base.KICAD_TUNNEL_NETWORK);
  assert.equal(config.services.cloudflared.environment.TUNNEL_TOKEN,base.CLOUDFLARE_TUNNEL_TOKEN);
  assert.equal(config.services.cloudflared.ports,undefined);
  assert.equal(config.services.cloudflared.privileged,undefined);
});

test("scoped VPS mode refuses inherited Doppler selection and never echoes secrets",()=>{
  for (const entry of [
    {DOPPLER_TOKEN:"synthetic-token-do-not-use"},
    {DOPPLER_PROJECT:"wrong-project"},
    {DOPPLER_CONFIG:"wrong-config"}
  ]) {
    const result=spawnSync("bash",["scripts/doppler-runtime.sh","node","--version"],
      {cwd:root,env:{PATH:process.env.PATH,KICAD_DOPPLER_SCOPED:"true",...entry},encoding:"utf8"});
    assert.equal(result.status,2);
    assert.match(result.stderr,/Ambiguous Doppler selection/);
    assert.ok(!Object.values(entry).some(value=>result.stderr.includes(value)));
  }
});
test("token enrollment only runs with an interactive terminal",()=>{
  const result=spawnSync("bash",["scripts/setup-vps-doppler.sh","test-project","test-config"],
    {cwd:root,env:{PATH:process.env.PATH},encoding:"utf8",input:"synthetic-token-do-not-use\n"});
  assert.equal(result.status,2);
  assert.match(result.stderr,/Interactive owner TTY required/);
  assert.doesNotMatch(result.stderr,/synthetic-token-do-not-use/);
});

// The first-install shell entrypoint can be exercised with a synthetic PATH.
// No real Docker, Doppler, Git remote or provider is contacted in these tests.
test("fresh-VPS preflight is nonmutating and refuses existing state",()=>{
  const dir=mkdtempSync(join(tmpdir(),"kicad-portable-preflight-"));
  const bin=join(dir,"bin"),log=join(dir,"commands.log");
  mkdirSync(bin);
  const fake=(name,body)=>writeFileSync(join(bin,name),"#!/usr/bin/env bash\nset -eu\n"+body+"\n",{mode:0o700});
  fake("git",String.raw`
    case "$*" in
      "remote get-url origin") printf '%s\n' 'https://github.com/oaslananka/kicad-mcp-pro-cloud.git';;
      "status --porcelain") ;;
      "rev-parse HEAD"|"rev-parse refs/remotes/origin/main") printf '%s\n' '1697bf37f689aac3f16eca2dc0b5827f055e9795';;
      "ls-remote origin refs/heads/main") printf '%s\n' '1697bf37f689aac3f16eca2dc0b5827f055e9795 refs/heads/main';;
      *) exit 98;;
    esac`);
  fake("docker",String.raw`
    printf 'docker %s\n' "$*" >> "$MOCK_LOG"
    if [[ "$*" == 'container inspect kicad-cloud-app-1' && "$MOCK_EXISTING" == container ]]; then exit 0; fi
    if [[ "$*" == 'volume inspect kicad-cloud_production_database' && "$MOCK_EXISTING" == volume ]]; then exit 0; fi
    case "$*" in
      info|"compose version"|"compose -f infra/compose.production.yml config --quiet"|"compose -f infra/compose.cloudflare.yml config --quiet") exit 0;;
      "container inspect "*|"volume inspect "*|"network inspect "*) exit 1;;
      *) exit 99;;
    esac`);
  fake("doppler",String.raw`
    printf 'doppler %s\n' "$*" >> "$MOCK_LOG"
    [[ "$1" == run && "$2" == --no-read-env && "$3" == -- ]] || exit 97
    shift 3
    exec "$@"`);
  try{
    for(const existing of ["", "container", "volume"]){
      writeFileSync(log,"");
      const result=spawnSync("bash",["scripts/bootstrap-production-vps.sh","preflight"],{
        cwd:root,encoding:"utf8",timeout:10000,
        env:{...base,PATH:bin+":"+process.env.PATH,
          MOCK_LOG:log,MOCK_EXISTING:existing,KICAD_DOPPLER_SCOPED:"true"}
      });
      const calls=readFileSync(log,"utf8");
      assert.doesNotMatch(calls,/docker (?:build|network create|compose .*up|compose .*run)/);
      if(!existing){
        assert.equal(result.status,0,result.stderr);
        assert.match(result.stdout,/New VPS preflight passed/);
        assert.match(calls,/docker compose -f infra\/compose.production.yml config --quiet/);
      }else{
        assert.notEqual(result.status,0);
        assert.match(result.stderr,/Existing (?:KiCad production containers|database volume) detected/);
        assert.doesNotMatch(calls,/doppler run/);
      }
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("offsite recovery rejects invalid Doppler selector before any remote operation",()=>{
  const result=spawnSync("bash",["scripts/offsite-backup-push.sh"],{
    cwd:root,encoding:"utf8",timeout:5000,
    env:{PATH:process.env.PATH,OFFSITE_REMOTE_SSH:"backup@127.0.0.1",
      OFFSITE_REMOTE_DIR:"/private/backup",
      OFFSITE_RESTORE_DOPPLER_PROJECT:"../not-allowed",
      OFFSITE_RESTORE_DOPPLER_CONFIG:"production"}
  });
  assert.equal(result.status,2);
  assert.match(result.stderr,/Invalid independent restore Doppler project\/config selector/);
});

test("synthetic fresh install requires exact-main CI and orders isolated provisioning",()=>{
  const dir=mkdtempSync(join(tmpdir(),"kicad-portable-install-"));
  const bin=join(dir,"bin"),log=join(dir,"commands.log");
  mkdirSync(bin);
  const fake=(name,body)=>writeFileSync(join(bin,name),"#!/usr/bin/env bash\nset -eu\n"+body+"\n",{mode:0o700});
  const head="1697bf37f689aac3f16eca2dc0b5827f055e9795";
  fake("git",String.raw`
    case "$*" in
      "remote get-url origin") echo 'https://github.com/oaslananka/kicad-mcp-pro-cloud.git';;
      "status --porcelain") ;;
      "rev-parse HEAD"|"rev-parse refs/remotes/origin/main") echo "$MOCK_HEAD";;
      "ls-remote origin refs/heads/main") echo "$MOCK_HEAD refs/heads/main";;
      *) exit 98;;
    esac`);
  fake("docker",String.raw`
    printf 'docker %s\n' "$*" >> "$MOCK_LOG"
    case "$*" in
      info|"compose version"|"compose -f infra/compose.production.yml config --quiet"|"compose -f infra/compose.cloudflare.yml config --quiet") exit 0;;
      "container inspect "*|"volume inspect "*|"network inspect "*) exit 1;;
      "network create --driver bridge "*) exit 0;;
      "build --pull=false "*) exit 0;;
      "inspect kicad-cloud-db-1 --format "*) echo healthy;exit 0;;
      "compose -f infra/compose.production.yml up -d db"|"compose -f infra/compose.production.yml up -d app"|"compose -f infra/compose.cloudflare.yml up -d cloudflared"|"compose -f infra/compose.production.yml run --rm app node dist/migrations-cli.js --apply") exit 0;;
      *) exit 99;;
    esac`);
  fake("doppler",String.raw`
    printf 'doppler %s\n' "$*" >> "$MOCK_LOG"
    [[ "$1" == run && "$2" == --no-read-env && "$3" == -- ]] || exit 97
    shift 3
    exec "$@"`);
  fake("curl",String.raw`
    printf 'curl %s\n' "$*" >> "$MOCK_LOG"
    if [[ "$*" == *'actions/workflows/ci.yml/runs'* ]]; then
      if [[ "$MOCK_CI_PASS" == yes ]]; then
        printf '{"workflow_runs":[{"head_sha":"%s","event":"push","status":"completed","conclusion":"success"}]}' "$MOCK_HEAD"
      else
        printf '{"workflow_runs":[]}'
      fi
    elif [[ "$*" == *'/health'* ]]; then
      printf '{"status":"ok","revision":"%s"}' "$MOCK_HEAD"
    else exit 96; fi`);
  fake("node",String.raw`
    if [[ "$1" == scripts/production-smoke.mjs ]]; then
      printf 'mock public smoke\n' >> "$MOCK_LOG"
      exit 0
    fi
    exec "$REAL_NODE" "$@"`);
  fake("systemctl",String.raw`
    printf 'UNAUTHORIZED systemctl %s\n' "$*" >> "$MOCK_LOG"
    exit 95`);
  try{
    for(const passing of [false,true]){
      writeFileSync(log,"");
      const result=spawnSync("bash",["scripts/bootstrap-production-vps.sh","install"],{
        cwd:root,encoding:"utf8",timeout:12000,
        env:{...base,PATH:bin+":"+process.env.PATH,REAL_NODE:process.execPath,
          MOCK_LOG:log,MOCK_HEAD:head,MOCK_CI_PASS:passing?"yes":"no",
          KICAD_DOPPLER_SCOPED:"true"}
      });
      const calls=readFileSync(log,"utf8");
      assert.doesNotMatch(calls,/UNAUTHORIZED systemctl/);
      if(!passing){
        assert.notEqual(result.status,0);
        assert.match(result.stderr,/CI proof unavailable/);
        assert.doesNotMatch(calls,/docker network create|docker build|migrations-cli.js --apply/);
      }else{
        assert.equal(result.status,0,result.stderr);
        assert.match(result.stdout,/Release timer NOT enabled/);
        assert.match(calls,/docker network create --driver bridge pcb_dedicated_ingress/);
        assert.match(calls,/migrations-cli.js --apply/);
        assert.match(calls,/docker compose -f infra\/compose.cloudflare.yml up -d cloudflared/);
        assert.match(calls,/mock public smoke/);
        assert.ok(calls.indexOf("docker network create") < calls.indexOf("migrations-cli.js --apply"));
      }
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
