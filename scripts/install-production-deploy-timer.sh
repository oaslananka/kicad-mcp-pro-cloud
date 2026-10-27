#!/usr/bin/env bash
# One-time setup on the existing authorized production VPS.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ $(git -C "$root" remote get-url origin) == 'https://github.com/oaslananka/kicad-mcp-pro-cloud.git' ]] || exit 1
[[ -z $(git -C "$root" status --porcelain) ]] || { echo 'Deployment worktree must be clean'; exit 1; }
units="$HOME/.config/systemd/user"
mkdir -p "$units"
cat > "$units/kicad-cloud-production.service" <<UNIT
[Unit]
Description=KiCad Cloud deploy verified main revision
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
WorkingDirectory=$root
ExecStart=/usr/bin/bash $root/scripts/production-deploy-if-ready.sh
Environment=KICAD_DOPPLER_SCOPED=${KICAD_DOPPLER_SCOPED:-false}
TimeoutStartSec=480
UNIT
cat > "$units/kicad-cloud-production.timer" <<'UNIT'
[Unit]
Description=Check approved KiCad Cloud releases every two minutes
[Timer]
OnBootSec=40s
OnUnitInactiveSec=120s
AccuracySec=10s
[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now kicad-cloud-production.timer
systemctl --user list-timers kicad-cloud-production.timer --no-pager
