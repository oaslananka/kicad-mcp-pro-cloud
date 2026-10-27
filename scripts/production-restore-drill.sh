#!/usr/bin/env bash
# Operator-only full, encrypted production backup restore to disposable PG17.
# Does NOT modify production DB, networks, application image or tunnel.
set -euo pipefail
umask 077

if [[ $# -ne 0 ]]; then
  echo 'Usage: doppler run -p kicad-mcp-pro -c prd_cloud -- bash scripts/production-restore-drill.sh' >&2
  exit 2
fi
for needed in docker age age-keygen mktemp openssl; do
  command -v "$needed" >/dev/null || { echo 'Restore drill prerequisite unavailable' >&2; exit 2; }
done
if [[ -z "${KICAD_BACKUP_AGE_IDENTITY:-}" || -z "${KICAD_BACKUP_AGE_RECIPIENT:-}" ]]; then
  echo 'Authorized production backup key/recipient unavailable' >&2
  exit 2
fi

BACKUP="$HOME/.local/share/kicad-cloud/backups/production-db-latest.pg.age"
[[ -f "$BACKUP" && ! -L "$BACKUP" && -s "$BACKUP" ]] || {
  echo 'Encrypted production backup not present as a regular nonempty file' >&2
  exit 2
}
# Strict fail closed on readable-by-others backup and symlinked parent.
if [[ -L "$(dirname "$BACKUP")" ]]; then
  echo 'Refusing symlinked backup directory' >&2
  exit 2
fi
backup_mode="$(stat -c '%a' "$BACKUP")"
if (( 8#$backup_mode & 077 )); then
  echo 'Encrypted backup permissions are too broad' >&2
  exit 2
fi
source_db="kicad-cloud-db-1"
[[ "$(docker inspect "$source_db" --format '{{.State.Health.Status}}')" == healthy ]] || {
  echo 'Production database is not healthy' >&2
  exit 1
}
suffix="$(openssl rand -hex 8)"
network="kicad-restore-drill-$suffix"
target="kicad-restore-pg-$suffix"
tmp_dir="$(mktemp -d /dev/shm/kicad-restore-key.XXXXXXXX)"
cleanup(){
  docker rm -f "$target" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$tmp_dir"
}
trap cleanup EXIT
printf '%s\n' "$KICAD_BACKUP_AGE_IDENTITY" > "$tmp_dir/identity"
chmod 600 "$tmp_dir/identity"
[[ "$(age-keygen -y "$tmp_dir/identity")" == "$KICAD_BACKUP_AGE_RECIPIENT" ]] || {
  echo 'Backup identity/recipient mismatch' >&2
  exit 1
}

fixture_pass="$(openssl rand -hex 24)"
docker network create --internal "$network" >/dev/null
# All decrypted customer metadata remains in disposable TMPFS, not host
# overlay volumes/disk. No production volume or published TCP port.
docker run --rm -d \
  --name "$target" --network "$network" \
  --tmpfs /var/lib/postgresql/data:rw,size=128m \
  --tmpfs /var/run/postgresql:rw,size=16m \
  --tmpfs /tmp:rw,size=16m \
  -e POSTGRES_USER=restore_fixture \
  -e POSTGRES_DB=restore_fixture \
  -e "POSTGRES_PASSWORD=$fixture_pass" \
  postgres:17-alpine >/dev/null
ready=false
for _ in {1..35}; do
  if docker exec "$target" pg_isready -q -U restore_fixture -d restore_fixture; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Isolated PostgreSQL unavailable'; exit 1; }

# Read authenticated age archive from private disk; decrypted bytes flow
# directly via pipe into PostgreSQL in RAM. Never write plaintext dump.
age -d -i "$tmp_dir/identity" "$BACKUP" |
 docker exec -i "$target" pg_restore \
  --exit-on-error --no-owner --no-acl \
  -U restore_fixture -d restore_fixture >/dev/null
query_target(){
  docker exec "$target" psql -X -q -A -t \
    -v ON_ERROR_STOP=1 -U restore_fixture -d restore_fixture -c "$1"
}
query_live(){
  docker exec -u postgres "$source_db" psql -X -q -A -t \
    -v ON_ERROR_STOP=1 -U kicad_cloud -d kicad_cloud -c "$1"
}
ledger_query="SELECT count(*)::text || ':' || coalesce(md5(string_agg(version::text || ':' || checksum, '|' ORDER BY version)), '') FROM schema_migrations"
restored_ledger="$(query_target "$ledger_query")"
live_ledger="$(query_live "$ledger_query")"
[[ "$restored_ledger" == "$live_ledger" ]] || {
  echo 'Live and restored schema migration ledgers differ (fresh snapshot required)' >&2
  exit 1
}
# Additional read-only checks for restored full schema and security fences.
for q in \
  'SELECT count(*) FROM devices' \
  'SELECT count(*) FROM projects' \
  'SELECT count(*) FROM project_client_grants' \
  'SELECT count(*) FROM "users"' \
  'SELECT count(*) FROM "oauthClient"' \
  'SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('\''kicad_fence_refresh_insert'\'','\''kicad_fence_opaque_access_insert'\'','\''kicad_fence_refresh_replay'\'')'
do
  [[ "$(query_live "$q")" == "$(query_target "$q")" ]] || {
    echo 'Full restore validation failed: security/metadata count mismatch' >&2
    exit 1
  }
done

echo 'PASS: encrypted live Cloud backup fully restored to isolated, disposable PostgreSQL 17 RAM; schema ledger, security triggers and metadata counts match production'
