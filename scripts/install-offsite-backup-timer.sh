#!/usr/bin/env bash
# Installs only this repo's user-level backup timer on the approved source VPS.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ -z "$(git -C "$root" status --porcelain)" ]] || { echo 'Release worktree must be clean' >&2; exit 2; }
conf="$HOME/.config/kicad-cloud/offsite.env"
[[ -f "$conf" && ! -L "$conf" && "$(stat -c %a "$conf")" == 600 ]] || {
  echo 'Private offsite endpoint config must already exist mode 0600' >&2; exit 2;
}
unit="$HOME/.config/systemd/user"
mkdir -p "$unit"
cat > "$unit/kicad-cloud-offsite.service" <<UNIT
[Unit]
Description=KiCad Cloud encrypted offsite backup with independent restore
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
EnvironmentFile=$conf
WorkingDirectory=$root
ExecStart=/usr/bin/bash $root/scripts/offsite-backup-push.sh
TimeoutStartSec=420
UNIT
cat > "$unit/kicad-cloud-offsite.timer" <<'UNIT'
[Unit]
Description=Daily owner-controlled KiCad Cloud encrypted backup and restore
[Timer]
OnCalendar=daily
Persistent=true
AccuracySec=20m
[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now kicad-cloud-offsite.timer
systemctl --user list-timers kicad-cloud-offsite.timer --no-pager
