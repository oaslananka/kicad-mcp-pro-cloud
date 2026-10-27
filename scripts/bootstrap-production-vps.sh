#!/usr/bin/env bash
# Initial installation on a NEW owner-controlled VPS only.
# Requires operator-provisioned Docker, Doppler CLI and a config-scoped service token.
# Never called by CI or the existing VPS release timer.
set -euo pipefail
mode=${1:-preflight}
[[ "$mode" == preflight || "$mode" == install ]] || { echo 'Usage: bootstrap-production-vps.sh [preflight|install]' >&2; exit 2; }
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
for command in docker git node doppler curl; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 2; }
done
[[ $(git remote get-url origin) == 'https://github.com/oaslananka/kicad-mcp-pro-cloud.git' ]] || { echo 'Unexpected source repository' >&2; exit 2; }
[[ -z $(git status --porcelain) ]] || { echo 'Refusing dirty checkout' >&2; exit 2; }
[[ $(git rev-parse HEAD) == $(git rev-parse refs/remotes/origin/main) ]] || { echo 'Installation must use a locally verified current origin/main' >&2; exit 2; }
remote_head=$(git ls-remote origin refs/heads/main | awk '{print $1}')
[[ "$remote_head" == "$(git rev-parse HEAD)" ]] || { echo 'Source is not current remote main: abort' >&2; exit 2; }
docker info >/dev/null
docker compose version >/dev/null
# Refuse existing KiCad state BEFORE fetching any configuration/secret.
if docker container inspect kicad-cloud-app-1 >/dev/null 2>&1 || docker container inspect kicad-cloud-db-1 >/dev/null 2>&1; then
  echo 'Existing KiCad production containers detected: refusing first-install workflow' >&2; exit 1
fi
if docker volume inspect kicad-cloud_production_database >/dev/null 2>&1; then
  echo 'Existing database volume detected: refusing potential data reuse' >&2; exit 1
fi
[[ "${KICAD_DOPPLER_SCOPED:-}" == true ]] || { echo 'Use a directory-scoped, read-only Doppler service token (KICAD_DOPPLER_SCOPED=true)' >&2; exit 2; }
scripts/doppler-runtime.sh node scripts/portable-config.mjs validate
network=$(scripts/doppler-runtime.sh node scripts/portable-config.mjs network)
[[ "$network" != ops_internal ]] || { echo 'Use a dedicated KICAD_TUNNEL_NETWORK on a new VPS; do not reuse the legacy shared network' >&2; exit 2; }
# Probe only secret presence; never emit the Tunnel token.
scripts/doppler-runtime.sh node -e 'if(!process.env.CLOUDFLARE_TUNNEL_TOKEN)process.exit(2)'
public_origin=$(scripts/doppler-runtime.sh node scripts/portable-config.mjs origin)
expected_google=$(scripts/doppler-runtime.sh node scripts/portable-config.mjs google)
[[ ! -e .env ]] || { echo 'Plaintext .env is forbidden for production' >&2; exit 2; }
if docker network inspect "$network" >/dev/null 2>&1; then
  echo 'Ingress network already exists: refusing ambiguous ownership/partial installation' >&2; exit 1
fi
scripts/doppler-runtime.sh docker compose -f infra/compose.production.yml config --quiet
scripts/doppler-runtime.sh docker compose -f infra/compose.cloudflare.yml config --quiet
printf 'New VPS preflight passed: reviewed Git source, Doppler config, isolated ingress selector and Compose syntax.\n'
if [[ "$mode" == preflight ]]; then exit 0; fi
# --install is intentionally explicit. Require successful main CI on the
# exact Git SHA before provisioning anything; never trust just a branch name.
revision=$(git rev-parse HEAD)
ci_payload=$(curl --fail --silent --show-error --max-time 15 \
  --header 'Accept: application/vnd.github+json' \
  'https://api.github.com/repos/oaslananka/kicad-mcp-pro-cloud/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=20')
if ! printf '%s' "$ci_payload" | node -e '
let body=""; process.stdin.on("data",part=>body+=part);
process.stdin.on("end",()=>{
 try{
  const runs=JSON.parse(body).workflow_runs;
  if(!Array.isArray(runs)||!runs.some(r=>r.head_sha===process.argv[1]&&
     r.event==="push"&&r.status==="completed"&&r.conclusion==="success"))process.exitCode=1;
 }catch{process.exitCode=1;}
});' "$revision"; then
  echo 'Exact-main successful CI proof unavailable; first install blocked' >&2
  exit 1
fi
# Does not configure DNS, provider OAuth, any other account or existing VPS.
docker network create --driver bridge "$network" >/dev/null
docker build --pull=false --build-arg "APP_REVISION=$revision" -t kicad-mcp-pro-cloud:production .
scripts/doppler-runtime.sh docker compose -f infra/compose.production.yml up -d db
healthy=false
for attempt in $(seq 1 30); do
  status=$(docker inspect kicad-cloud-db-1 --format '{{.State.Health.Status}}')
  if [[ "$status" == healthy ]]; then healthy=true; break; fi
  sleep 2
done
[[ "$healthy" == true ]] || { echo 'Database did not become healthy; installation incomplete' >&2; exit 1; }
# This is a newly created database. Existing databases require separate
# backup, review and operator-authorized migration, not this installer.
scripts/doppler-runtime.sh docker compose -f infra/compose.production.yml run --rm app node dist/migrations-cli.js --apply
scripts/doppler-runtime.sh docker compose -f infra/compose.production.yml up -d app
scripts/doppler-runtime.sh docker compose -f infra/compose.cloudflare.yml up -d cloudflared
# Cloudflare Tunnel, DNS and TLS may need a short time to become usable.
# Bounded readiness never masks a wrong domain, route or revision.
public_ready=false
for _ in $(seq 1 20); do
  observed=$(curl --fail --silent --show-error --max-time 7 \
    "$public_origin/health" 2>/dev/null | \
    node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>{try{const h=JSON.parse(b);if(h.status==="ok")process.stdout.write(h.revision??"")}catch{}})' || true)
  if [[ "$observed" == "$revision" ]]; then public_ready=true; break; fi
  sleep 3
done
[[ "$public_ready" == true ]] || {
  echo 'Public HTTPS ingress did not reach the expected reviewed revision; install incomplete' >&2
  exit 1
}
# Public routing and OAuth registration must be accepted before installation.
PUBLIC_ORIGIN="$public_origin" EXPECTED_GOOGLE_OAUTH="$expected_google" EXPECTED_REVISION="$revision" node scripts/production-smoke.mjs
# A second VPS polling the same GitHub main would trigger unapproved parallel
# production releases. Enabling its timer is a separate owner-controlled cutover.
printf 'PASS: new VPS initial installation verified at %s\n' "$public_origin"
printf 'Release timer NOT enabled. Accept the owner cutover and stop the old VPS timer before enabling the new one.\n'
