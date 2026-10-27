# Cloud production database full-restore acceptance

Updated 27 October 2026. The live PostgreSQL 17 schema ledger is now
**001–012** after a reviewed, transactional, schema-only release.
Production HTTPS, GitHub sign-in, ChatGPT OAuth, assets, health, MCP
resource discovery, anonymous 401 and disabled-device UI passed.

A fresh age-encrypted production pg_dump was created using the authorized
Doppler project kicad-mcp-pro, config prd_cloud. The encrypted snapshot
was fully restored into a new disposable, internal-network, RAM-backed
PostgreSQL 17 instance by scripts/production-restore-drill.sh.

The restored schema checksum ledger, OAuth security-trigger count and
core metadata row counts matched the live source. The temporary database
and network were removed. No live table, app image, Tunnel, hostname,
migration or feature flag was changed.

Manual revalidation:
1. doppler run -p kicad-mcp-pro -c prd_cloud -- bash scripts/production-backup.sh
2. doppler run -p kicad-mcp-pro -c prd_cloud -- bash scripts/production-restore-drill.sh

The restore script rejects absent, linked, broadly accessible or
undecryptable snapshots, and fails closed on schema or metadata mismatch.
Decrypted customer data is streamed only into disposable PostgreSQL
memory. It never writes a plaintext backup to host disk or exposes ports.

## Production schema 006 to 012 rehearsal — 27 October 2026

The real encrypted production snapshot was fully restored into a
disposable RAM-only PostgreSQL 17 container. The optional
--rehearse-schema mode invoked the actual compiled Cloud migration
CLI using only generated fixture database credentials and the
existing application runtime image, with repository sources
mounted read-only.

The clone successfully reached schema 012 from the original 006;
all six new device/session/budget tables exist, original metadata
counts remained unchanged, and a repeated apply was idempotent.
This historical rehearsal ran before the live schema-only migration.
Production later advanced to schema 012, separately verified below.

Operator commands, after a current backup and local build:

    npm run build
    doppler run -p kicad-mcp-pro -c prd_cloud -- bash scripts/production-restore-drill.sh --rehearse-schema

This mode requires a live source baseline of 006; after production
migration it must not be reused as a generic backup checker.
At the time of this initial rehearsal, no production migration or independent
offsite restore had occurred. Both milestones were independently completed
later on 27 October 2026, as recorded below.

## Independent encrypted offsite recovery — ACCEPTED 27 October 2026

The previously blocking proof has now been performed on a **second
owner-controlled machine** over an existing authenticated, private Tailscale
SSH connection. No public SSH listener or new cloud billing was introduced.

1. The production database generated a fresh age-encrypted snapshot using
   authorized Doppler keys. The source instance passed its existing full
   isolated PostgreSQL 17 restore drill.
2. **Only encrypted ciphertext** was copied to a separate workstation. Both
   ends reported identical SHA-256 digest
   `a119dc0904e365907aaa0b5d09a6d948ae8f2f3b56218e97fa565e4bbe9fcf9d`.
   The remote private file is mode 0600 and its directory mode 0700.
3. The independent machine obtained the age recovery identity directly from
   its **own** authorized Doppler session, not from the production VPS or the
   transferred archive. The secret was staged only in RAM and removed.
4. In a separately launched PostgreSQL 17 container with `--network none`
   and RAM-only database, a full `pg_restore --exit-on-error` succeeded.
   Recovery returned schema 006, ledger checksum
   `6:8c60b4f1f7adfffce2015b4fd484ca31`, three OAuth security triggers,
   and exact source-side core metadata counts (one account, one client,
   one consent and no devices/projects/grants). The temporary database and
   container were deleted without publishing a port. No plaintext archive
   was saved on either persistent host disk.
5. The existing production database, ingress, live image and OAuth grants
   were unchanged throughout the independent recovery test.

Repeatable, secret-free verification code is
`scripts/offsite-restore-verify.sh`. On the **independent** host, after an
operator transfers a fresh age ciphertext over an explicitly authorized
channel and records the source hash and ledger receipt:

    EXPECTED_SHA256=<source-sha256> EXPECTED_SCHEMA_VERSION=6 \
      EXPECTED_LEDGER=<source-count:ledger-md5> \
      doppler run -p kicad-mcp-pro -c prd_cloud -- \
      bash scripts/offsite-restore-verify.sh /private/offsite-snapshot.pg.age

The sample path is not an instruction to share age identities, credentials,
user data or internal machine names with GitHub. The test fails closed on a
missing source receipt, file permission error, invalid key, bad checksum,
unfinished PostgreSQL initialization, invalid migration ledger or missing
security fences.

### Production schema 012 migration acceptance — 27 October 2026

After the independent recovery acceptance, a **second fresh encrypted
snapshot** was copied to the same independently controlled offsite destination
and recovered in another fresh network-isolated, RAM-only PostgreSQL 17
container. Matching source/ciphertext SHA-256 and full schema-006 ledger and
three OAuth fences were confirmed immediately before the bounded migration.

The production application `main` release had passed exact-head GitHub CI,
Production Deployment, real Chromium sign-in, and responsive layout checks.
The existing migration engine applied all 007–012 files **in one PostgreSQL
transaction**. No application, Tunnel, OAuth provider setting, WSS or device
pairing flag was changed. The live database returned `current=12`,
`pending=[]`; all six expected tables exist, and original user/OAuth/client
record counts remained intact. Real browser `/account`, `/connections`,
`/devices`, original MCP anonymous-401, and server health passed.

A **fresh post-migration snapshot** was then copied to the independent
workstation and independently restored again. Receipt:

- SHA-256 `045a80f7abb4254d999e5a2623ca1e71b19f1d7ac2b4f1ca0bfac8264e8bc245`
- Schema ledger `12:a75d9e512df4f9701d60babcd9544622`
- OAuth security fences `3`, independent full `pg_restore` PASS
- Encrypted offsite archive mode 0600, temporary RAM-only container removed

### Ongoing offsite backup operations

`scripts/offsite-backup-push.sh` uses authenticated, pinned-host SSH to an
operator-owned private destination, copies **only age ciphertext**, confirms
the source SHA-256, runs a full independent restore via the second host's
own Doppler credentials, and then retains the last **three** project-owned
ciphertexts. It does not handle any other project's backups.

The per-host settings are outside Git:

    OFFSITE_REMOTE_SSH=<approved-user>@<trusted-private-ip>
    OFFSITE_REMOTE_DIR=/private/approved/kicad-cloud/offsite

Use a mode-0600 user environment file; `scripts/install-offsite-backup-timer.sh`
installs the one-project `systemd --user` daily timer. Run one scheduled
service acceptance and verify retention and unit status before declaring
automatic protection operational. If the independent machine is offline,
the job **fails visibly** and must be retried; no failed backup is silently
counted as accepted. A separate user-visible stale-backup alert is desirable.

Do not silently re-enable previously blocked R2 data egress, assume an
always-on workstation, or imply enterprise-grade disaster recovery.

## Migration gate

The database-only migration gate was accepted and **production is on 012**.
This does **not** enable device enrollment or remote KiCad execution.
Preserve the working built-in GitHub and ChatGPT OAuth mode. Pairing-device
API and connector WSS feature flags stay OFF until separate dedicated Tunnel,
source provenance, edge rate limiting and real-device connection acceptance.
Do not combine network cutover or remote device rollout with DB migration.

The current full-restore proof is stronger than the old archive-parser
check, but it is not disaster recovery by itself.
