# Infrastructure-as-code adoption gate

We now produce a secret-free OCI application image, but production destination,
network policy, Cloudflare DNS ownership, PostgreSQL backup/restore, auth
registrations, and deployment credentials are not yet verified. This directory
therefore contains no unreviewed OpenTofu provider or resource definitions.

When the destination is verified, use a minimal, reviewed OpenTofu module in
this repository. Pin provider and OpenTofu versions; separate state per
environment; review plan before apply. Never fetch app secrets into OpenTofu
state or pass them through outputs, plan, or cloud-init. Provision only concrete
infrastructure (HTTPS routing, firewall, persistent DB and DNS if appropriate).
Do not replace working equivalent services merely for consistency.

Build the image without secrets. At runtime inject Doppler configuration through
a controlled secret bootstrap. Docker environment variables can be retrieved by
privileged Docker operators; do not assume container inspect is a secret vault.
Do not copy Doppler downloads to repository files or image layers.

Production release needs real login + consent flows, MCP clients, database
restore drill, digest-pinned image deploy and tested rollback. None are proven
by this image build.

## Controlled versioned PostgreSQL migrations

Use the reviewed, checksum-verified migration runner instead of concatenating
SQL files manually. It has **no startup hook** and runs no production command
from a pull request. It requires an explicit flag and a Doppler-injected DB URL:

    doppler run -- npm run db:migrate -- --status
    doppler run -- npm run db:migrate -- --apply

The status operation does not create tables. Apply takes a PostgreSQL
transaction-scoped advisory lock, verifies the stored filename/SHA-256 ledger,
and applies *all* pending SQL versions atomically. Re-running a completed
migration does nothing. Modified or missing historic migrations, version gaps
and partially hand-created schemas fail closed; there is no automatic
"repair"/baseline or silent destructive rollback. Use an operator-reviewed
recovery procedure for existing deployments.

Before a production apply: choose and independently verify the Doppler
environment, take a database backup, rehearse a restore, inspect the SQL
diff and hold deployment while database schema is being updated. The runner
does not provision databases, validate backup restore or deploy application
containers. Migration 003 is pinned to Better Auth 1.7.13; upgrades require a
separate schema review. CI tests only in a disposable PostgreSQL 17 schema.

## Disposable PostgreSQL backup/restore acceptance

The CI workflow runs scripts/ci-db-restore-drill.sh using the same secret-free
OCI image it just built. The script creates its own two disposable PostgreSQL
17 containers and an internal-only Docker network, with no host-bound ports.
The only credentials in this fixture are literal, non-production test values;
no Doppler or application environment is read.

It explicitly applies reviewed migrations 001–006, seeds synthetic
device/project/client metadata and an OAuth revocation cutoff, streams a
PostgreSQL custom-format dump into an empty target with restore-on-error, and
checks the following:
- migration checksum ledger is retained and repeat application is harmless;
- metadata, per-client project grant and revocation cutoff survive;
- all OAuth issuance/replay triggers are present after restore;
- a late synthetic refresh-token INSERT is rejected by SQLSTATE 23514;
- disposable containers and isolated network are cleaned up on completion.

For local reproduction, build the reviewed OCI image and run:
    bash scripts/ci-db-restore-drill.sh kicad-mcp-pro-cloud:ci

This is not a real staging recovery exercise: it does not validate external
backup encryption, retention, offsite copies, real restore RTO/RPO, or
application rollback. Those require an approved staging environment.
