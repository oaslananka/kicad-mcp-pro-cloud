#!/usr/bin/env bash
# Owner-controlled encrypted production DB backup replication to a separate
# machine. No third-party storage billing or plaintext/offsite secret transfer.
set -euo pipefail
umask 077
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
: "${OFFSITE_REMOTE_SSH:?Approved owner-controlled SSH target required}"
: "${OFFSITE_REMOTE_DIR:?Approved owner-controlled absolute backup directory required}"
[[ "$OFFSITE_REMOTE_SSH" =~ ^[a-z_][a-z0-9_-]*@[0-9.]+$ ]] || {
  echo 'Remote SSH identity must be a fixed owner@IPv4 endpoint' >&2; exit 2;
}
[[ "$OFFSITE_REMOTE_DIR" =~ ^/[a-zA-Z0-9_./-]+$ && "$OFFSITE_REMOTE_DIR" != *'..'* ]] || {
  echo 'Remote directory must be a reviewed absolute private path' >&2; exit 2;
}
ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8)
remote="$OFFSITE_REMOTE_SSH"
dir="$OFFSITE_REMOTE_DIR"
# No shared/other-application backup objects are ever deleted.
ssh "${ssh_opts[@]}" "$remote" "test -d '$dir' && test ! -L '$dir' && test \"\$(stat -c %a '$dir')\" = 700"
# Re-encrypt from the live database with existing Doppler-held identity.
doppler run -p kicad-mcp-pro -c prd_cloud -- bash scripts/production-backup.sh
src="$HOME/.local/share/kicad-cloud/backups/production-db-latest.pg.age"
[[ -f "$src" && ! -L "$src" && "$(stat -c %a "$src")" == 600 ]]
sha=$(sha256sum "$src" | awk '{print $1}')
[[ "$sha" =~ ^[a-f0-9]{64}$ ]]
filename="production-db-${sha:0:16}.pg.age"
version=$(docker exec kicad-cloud-db-1 psql -U kicad_cloud -d kicad_cloud -At \
  -c 'SELECT max(version) FROM schema_migrations')
ledger=$(docker exec kicad-cloud-db-1 psql -U kicad_cloud -d kicad_cloud -At \
  -c "SELECT count(*)::text || ':' || coalesce(md5(string_agg(version::text || ':' || checksum, '|' ORDER BY version)), '') FROM schema_migrations")
[[ "$version" =~ ^([1-9]|1[0-2])$ && "$ledger" =~ ^[1-9][0-9]*:[a-f0-9]{32}$ ]]
# Destination is always immutable and contains only ciphertext.
ssh "${ssh_opts[@]}" "$remote" "test ! -e '$dir/$filename'"
scp -q "${ssh_opts[@]}" "$src" "$remote:$dir/.partial-$filename"
remote_hash=$(ssh "${ssh_opts[@]}" "$remote" "sha256sum '$dir/.partial-$filename' | cut -d' ' -f1")
[[ "$remote_hash" == "$sha" ]] || { echo 'Remote encrypted archive checksum mismatch' >&2; exit 1; }
ssh "${ssh_opts[@]}" "$remote" "chmod 600 '$dir/.partial-$filename' && mv -n '$dir/.partial-$filename' '$dir/$filename' && test \"\$(stat -c %a '$dir/$filename')\" = 600"
# Execute the reviewed script directly on the remote host via stdin; the
# identity is acquired from the *remote* host's own Doppler session.
ssh "${ssh_opts[@]}" "$remote" \
  "EXPECTED_SHA256=$sha EXPECTED_SCHEMA_VERSION=$version EXPECTED_LEDGER=$ledger doppler run -p kicad-mcp-pro -c prd_cloud -- bash -s -- '$dir/$filename'" \
  < scripts/offsite-restore-verify.sh
# Retain three latest project-only ciphertext versions. Delete nothing on an
# unsuccessful checksum or full independent restore.
ssh "${ssh_opts[@]}" "$remote" "python3 - '$dir' <<'PY'
import os,re,stat,sys
p=sys.argv[1]
if os.path.islink(p) or stat.S_IMODE(os.stat(p).st_mode)!=0o700: raise SystemExit(2)
files=[]
for e in os.scandir(p):
 if re.fullmatch(r'production-db-[a-f0-9]{16}\\.pg\\.age',e.name) and e.is_file(follow_symlinks=False):
  files.append((e.stat(follow_symlinks=False).st_mtime_ns,e.path))
for _,path in sorted(files,reverse=True)[3:]: os.unlink(path)
PY"
echo "PASS: encrypted offsite backup independently restored; schema=$version, source_sha256=$sha, retention<=3"
