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

## Offsite recovery remains BLOCKED

The verified backup is on the same VPS as production. An independent
offsite encrypted copy has NOT been created or restored. The connected
tooling blocked the attempt to transmit encrypted ciphertext to R2;
do not bypass those controls. The private R2 bucket was observed to
have no public custom domain and r2.dev disabled, but this does not
prove that a backup object exists there.

An authorized independent backup operator must upload only the
already-encrypted archive, download it again, confirm matching bytes,
then perform full PostgreSQL restore from that independently recovered
copy. Protect age identity custody independently of the VPS and
establish retention, periodic execution and alerts. Do not delete or
alter other applications' remote backup objects.

## Migration gate

Pending migrations 007–012 remain unapplied in production. Applying
them requires verified offsite restore evidence, active-image
compatibility, an explicit migration/rollback window and a successful
post-migration smoke test. Keep AUTH_MODE=external and pairing/WSS
feature flags OFF during database-only migration. Do not combine it
with Cloudflare Tunnel cutover or provider OAuth rollout.

The current full-restore proof is stronger than the old archive-parser
check, but it is not disaster recovery by itself.
