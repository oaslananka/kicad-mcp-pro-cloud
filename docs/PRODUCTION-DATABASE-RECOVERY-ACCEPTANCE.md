# Cloud production database full-restore acceptance

Verified 27 October 2026. Live PostgreSQL 17 schema ledger: 001–006.
Production HTTPS, assets, health, MCP discovery, anonymous 401 and
disabled sign-in smoke tests passed.

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
The original live database remains at schema 006.

Operator commands, after a current backup and local build:

    npm run build
    doppler run -p kicad-mcp-pro -c prd_cloud -- bash scripts/production-restore-drill.sh --rehearse-schema

This mode requires a live source baseline of 006; after production
migration it must not be reused as a generic backup checker.
No production migration or independent offsite restore occurred.

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

**Operational limitation:** this proof is an independent point-in-time restore,
not proof of recurring offsite backup scheduling, retention or automated alerts.
The second workstation can be offline. A recurring owner-approved destination,
key-recovery policy and failure alert must be established for sustained
production disaster recovery; do not silently re-enable previously denied
R2 egress or assume a same-host copy meets this requirement.

## Migration gate

Pending migrations 007–012 remain unapplied in production. The **independent
restore proof** is now available; the remaining gates are the currently
reviewed application image and schema manifest, an explicit bounded
migration/recovery window, and successful post-migration authentication,
project inventory and owner-UI smoke tests. Preserve the **currently working
built-in GitHub and ChatGPT OAuth mode** (do not switch to external auth)
and keep pairing-device API and connector WSS flags OFF throughout the
schema-only migration. Do not combine it
with Cloudflare Tunnel cutover or provider OAuth rollout.

The current full-restore proof is stronger than the old archive-parser
check, but it is not disaster recovery by itself.
