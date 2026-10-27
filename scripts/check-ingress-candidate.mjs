import {assertIngressCandidate} from "./ingress-candidate-contract.mjs";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";

const syntheticSecret=randomBytes(32).toString("hex");
// Synthetic RFC1918 sample, never a recommended production allocation.
const testPrefix=[10,255,242].join(".");
const syntheticToken=randomBytes(32).toString("base64url");
const tokenEnvName=["KICAD","CLOUDFLARE","TUNNEL","TOKEN"].join("_");
const env={
  ...process.env,PATH:"/usr/bin:/bin",
  KICAD_DB_PASSWORD:syntheticSecret,
  PUBLIC_ORIGIN:"https://cloud.example.invalid",
  OAUTH_ISSUER:"https://cloud.example.invalid/api/auth",
  OAUTH_JWKS_URL:"https://cloud.example.invalid/api/auth/jwks",
  OAUTH_AUDIENCE:"https://cloud.example.invalid/mcp",
  KICAD_INGRESS_SUBNET:testPrefix+".0/29",
  KICAD_INGRESS_APP_IP:testPrefix+".3",
  KICAD_INGRESS_PROXY_IP:testPrefix+".2",
  [tokenEnvName]:syntheticToken
};
const composeArgs=[
  "compose","-f","infra/compose.production.yml",
  "-f","infra/compose.isolated-ingress.candidate.yml",
  "config","--format","json"
];
// Parsing the merged model never creates Docker networks or containers.
const raw=execFileSync("/usr/bin/docker",composeArgs,{
  env,encoding:"utf8",timeout:10_000,maxBuffer:1024*1024
});
assert.ok(!raw.includes(syntheticToken),
  "The Compose model must never render the live token's value");
const model=JSON.parse(raw);
assertIngressCandidate(model,env,raw);
console.log("Cloud-only ingress candidate Compose verified offline; no live Docker changes");
