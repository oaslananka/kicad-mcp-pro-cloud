#!/usr/bin/env bash
# Offline integration contract for bootstrap-production-vps.sh.
# All Git/Docker/Doppler/curl/node calls are intercepted by synthetic binaries;
# no cloud provider, remote repository or live Docker daemon is contacted.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/kicad-bootstrap-fixture.XXXXXXXX")
chmod 700 "$sandbox"
bin="$sandbox/bin"
mkdir -m 700 "$bin"
log="$sandbox/calls.log"
trap 'rm -rf -- "$sandbox"' EXIT
mock_head='1697bf37f689aac3f16eca2dc0b5827f055e9795'
real_node=$(command -v node)
cat > "$bin/git" <<'MOCK'
#!/usr/bin/env bash
set -eu
case "$*" in
  'remote get-url origin') echo 'https://github.com/oaslananka/kicad-mcp-pro-cloud.git';;
  'status --porcelain') ;;
  'rev-parse HEAD'|'rev-parse refs/remotes/origin/main') echo "$MOCK_HEAD";;
  'ls-remote origin refs/heads/main') printf '%s\n' "$MOCK_HEAD refs/heads/main";;
  *) exit 98;;
esac
MOCK
cat > "$bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf 'docker %s\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == 'container inspect kicad-cloud-app-1' && "$MOCK_EXISTING" == container ]]; then exit 0; fi
if [[ "$*" == 'volume inspect kicad-cloud_production_database' && "$MOCK_EXISTING" == volume ]]; then exit 0; fi
case "$*" in
  info|'compose version'|'compose -f infra/compose.production.yml config --quiet'|'compose -f infra/compose.cloudflare.yml config --quiet') exit 0;;
  'container inspect '*|'volume inspect '*|'network inspect '*) exit 1;;
  'network create --driver bridge '*|'build --pull=false '*) exit 0;;
  'inspect kicad-cloud-db-1 --format '*) echo healthy; exit 0;;
  'compose -f infra/compose.production.yml up -d db'|'compose -f infra/compose.production.yml up -d app'|'compose -f infra/compose.cloudflare.yml up -d cloudflared'|'compose -f infra/compose.production.yml run --rm app node dist/migrations-cli.js --apply') exit 0;;
  *) exit 99;;
esac
MOCK
cat > "$bin/doppler" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf 'doppler %s\n' "$*" >> "$MOCK_LOG"
[[ "$1" == run && "$2" == --no-read-env && "$3" == -- ]] || exit 97
shift 3
exec "$@"
MOCK
cat > "$bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf 'curl %s\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == *'actions/workflows/ci.yml/runs'* ]]; then
  if [[ "$MOCK_CI_PASS" == yes ]]; then
    printf '{"workflow_runs":[{"head_sha":"%s","event":"push","status":"completed","conclusion":"success"}]}' "$MOCK_HEAD"
  else
    printf '{"workflow_runs":[]}'
  fi
elif [[ "$*" == *'/health'* ]]; then
  printf '{"status":"ok","revision":"%s"}' "$MOCK_HEAD"
else exit 96; fi
MOCK
cat > "$bin/node" <<'MOCK'
#!/usr/bin/env bash
set -eu
if [[ "$1" == scripts/production-smoke.mjs ]]; then
  printf 'mock public smoke\n' >> "$MOCK_LOG"
  exit 0
fi
exec "$REAL_NODE" "$@"
MOCK
chmod 700 "$bin"/*
export MOCK_HEAD="$mock_head" REAL_NODE="$real_node" MOCK_LOG="$log"
export PUBLIC_ORIGIN='https://pcb.example.test'
export OAUTH_ISSUER="$PUBLIC_ORIGIN/api/auth"
export OAUTH_JWKS_URL="$PUBLIC_ORIGIN/api/auth/jwks"
export OAUTH_AUDIENCE="$PUBLIC_ORIGIN/mcp"
export KICAD_DB_PASSWORD='synthetic-test-password'
export AUTH_MODE='builtin' BETTER_AUTH_SECRET='synthetic-test-secret'
export GITHUB_CLIENT_ID='test-id' GITHUB_CLIENT_SECRET='synthetic-test-client-secret'
export KICAD_TUNNEL_NETWORK='pcb_dedicated_ingress'
export CLOUDFLARE_TUNNEL_TOKEN='synthetic-test-tunnel-token'
export KICAD_DOPPLER_SCOPED=true
unset DOPPLER_TOKEN DOPPLER_PROJECT DOPPLER_CONFIG || true
# The executable override exists only for this test subprocess, scoped to a
# mode-0700 temporary directory and deleted on EXIT.
export PATH="$bin:$PATH"
run_fixture() {
  local mode="$1"
  : > "$log"
  MOCK_EXISTING="$2" MOCK_CI_PASS="$3" bash scripts/bootstrap-production-vps.sh "$mode"
}
assert_no_mutation() {
  if grep -Eq 'docker (network create|build |compose .* (up|run))' "$log"; then
    echo 'FAIL: mocked preflight/CI failure attempted a mutation' >&2
    exit 1
  fi
}
output=$(run_fixture preflight '' no)
[[ "$output" == *'New VPS preflight passed'* ]]
assert_no_mutation
echo 'PASS: non-mutating new VPS preflight'
for existing in container volume; do
  if output=$(run_fixture preflight "$existing" no 2>&1); then
    echo 'FAIL: existing state was accepted' >&2
    exit 1
  fi
  [[ "$output" == *'Existing'*'detected'* ]]
  assert_no_mutation
  if grep -q 'doppler run' "$log"; then
    echo 'FAIL: secrets fetched despite existing production state' >&2
    exit 1
  fi
done
echo 'PASS: existing app/database safely rejected'
if output=$(run_fixture install '' no 2>&1); then
  echo 'FAIL: installation accepted an unverified CI revision' >&2
  exit 1
fi
[[ "$output" == *'CI proof unavailable'* ]]
assert_no_mutation
echo 'PASS: installation fails closed without exact-SHA CI proof'
output=$(run_fixture install '' yes)
[[ "$output" == *'Release timer NOT enabled'* ]]
grep -q 'docker network create --driver bridge pcb_dedicated_ingress' "$log"
grep -q 'migrations-cli.js --apply' "$log"
grep -q 'docker compose -f infra/compose.cloudflare.yml up -d cloudflared' "$log"
grep -q 'mock public smoke' "$log"
if grep -Eq 'systemctl|kicad-cloud-production.timer' "$log"; then
  echo 'FAIL: installer touched an existing release watcher' >&2
  exit 1
fi
echo 'PASS: fresh install provisions in isolation without enabling another release watcher'
