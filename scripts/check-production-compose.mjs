import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";

// This is a fixture-only check. No production Doppler credentials are read.
const fixturePassword=randomBytes(20).toString("hex");
const env={...process.env,
  PATH:"/usr/bin:/bin",
  KICAD_DB_PASSWORD:fixturePassword,
  PUBLIC_ORIGIN:"https://cloud.example.invalid",
  OAUTH_ISSUER:"https://cloud.example.invalid/api/auth",
  OAUTH_JWKS_URL:"https://cloud.example.invalid/api/auth/jwks",
  OAUTH_AUDIENCE:"https://cloud.example.invalid/mcp"
};
const json=execFileSync("/usr/bin/docker",
  ["compose","-f","infra/compose.production.yml","config","--format","json"],
  {env,encoding:"utf8"});
const config=JSON.parse(json);
assert.deepEqual(Object.keys(config.services).sort((a,b)=>a.localeCompare(b)),["app","db"]);
assert.equal(config.services.app.image,"kicad-mcp-pro-cloud:production");
assert.equal(config.services.app.environment.AUTH_MODE,"external");
assert.equal(config.services.app.environment.PGPASSWORD,fixturePassword);
assert.equal(config.services.app.environment.DATABASE_URL,"postgresql://kicad_cloud@db:5432/kicad_cloud");
assert.equal(config.services.db.environment.POSTGRES_PASSWORD,fixturePassword);
for(const service of Object.values(config.services)) {
  assert.equal(service.ports,undefined,"Production must not publish host ports");
}
assert.equal(config.networks.database.internal,true);
assert.equal(config.networks.tunnel.external,true);
assert.equal(config.networks.tunnel.name,"ops_internal");
const health=config.services.app.healthcheck.test;
assert.deepEqual(health.slice(0,3),["CMD","node","-e"]);
// --check parses standard input without executing the healthcheck.
assert.doesNotThrow(()=>execFileSync(process.execPath,["--check"],{
  input:health[3],encoding:"utf8",env
}));
console.log("Production Compose topology and healthcheck syntax verified");
