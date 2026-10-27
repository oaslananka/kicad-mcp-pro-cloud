# Direct production; single active application image

No staging environment. Docker Compose retains one active KiCad application
image, kicad-mcp-pro-cloud:production, plus PostgreSQL 17 as a required
infrastructure service. No rollback application images are retained.

The database network is internal with no published port. The application
joins that network plus the preexisting ops_internal Cloudflare tunnel
network. Other services and domains are untouched.

All persistent secrets are in Doppler project kicad-mcp-pro / config prd_cloud.
Required variables: KICAD_DB_PASSWORD, PUBLIC_ORIGIN,
OAUTH_ISSUER, OAUTH_JWKS_URL and OAUTH_AUDIENCE. DATABASE_URL contains no credentials; pg uses PGPASSWORD from the Doppler password.
GitHub Secrets must contain only DOPPLER_TOKEN.

This release explicitly fixes AUTH_MODE=external. Actual Google/GitHub login
and ChatGPT/Claude OAuth callbacks have not yet completed acceptance. A
working premium page or /health does not imply that the device connector
or remote KiCad execution is operational.

## Reviewed VPS runbook

From the checked-out repository root:

1. Build the single image: docker build -t kicad-mcp-pro-cloud:production .
2. Inject Doppler config into Docker Compose invocation:
   doppler run -p kicad-mcp-pro -c prd_cloud -- docker compose -f infra/compose.production.yml up -d db
3. Review SQL and backup. Check pending migrations, then explicitly apply:
   doppler run -p kicad-mcp-pro -c prd_cloud -- docker compose -f infra/compose.production.yml run --rm app node dist/migrations-cli.js --status
   For an approved apply, change --status to --apply.
4. Start application:
   doppler run -p kicad-mcp-pro -c prd_cloud -- docker compose -f infra/compose.production.yml up -d app
5. Set Cloudflare route only for the approved hostname to
   http://kicad-cloud-app-1:8787; retain all other tunnel entries and 404 fallback.
6. Confirm /health, /, /assets/ui.css, OAuth resource metadata, and
   401 authentication_required on an anonymous MCP request. No app or DB
   ports should be publicly published.
7. Remove unused obsolete KiCad app images only. Do not run global image
   prune: this VPS hosts other independent production services.

Migrations do not execute at server startup. Production database backups
remain necessary even though no app rollback image is retained.

## Production-only operational checks and database recovery

The following checks create neither staging nor a second application image.

After a release, execute:
    node scripts/production-smoke.mjs

The script verifies HTTPS, the premium page and CSS, honest connector status,
OAuth resource metadata, anonymous MCP denial and disabled signup.

For a private single encrypted database snapshot, execute on the VPS:
    doppler run -p kicad-mcp-pro -c prd_cloud -- bash scripts/production-backup.sh

Production Doppler must contain KICAD_BACKUP_AGE_IDENTITY and its corresponding
KICAD_BACKUP_AGE_RECIPIENT. The script streams a logical pg_dump through
authenticated age encryption, verifies decryption and pg_restore archive
parsing, and atomically replaces one private encrypted snapshot in the
Ubuntu account's home directory. It does not create Docker images or leave
plaintext PostgreSQL backups.

Limits: this same-host snapshot is NOT offsite disaster recovery and archive
parsing is NOT a full restore test. VPS disk loss could destroy both the live
database and this snapshot. No automated backup cadence or remote retention
policy is configured yet. A remote destination and restore acceptance are
needed before storing real customer data.

## Full encrypted restore validation

Cloud now includes scripts/production-restore-drill.sh. It restores the
production age-encrypted backup into a disposable, isolated, tmpfs-only
PostgreSQL 17 container and checks checksum ledger, security triggers
and core metadata against the live DB. It does not modify production.
See docs/PRODUCTION-DATABASE-RECOVERY-ACCEPTANCE.md.

This is NOT offsite disaster recovery. Migrations 007–012 remain blocked
until an independently downloaded remote encrypted archive passes
another full restore. Never treat a same-host backup as offsite.


## Schema 007-012 production-snapshot rehearsal

The optional --rehearse-schema switch on
scripts/production-restore-drill.sh invokes the real Cloud migration
engine against an isolated RAM-backed database cloned from the latest
encrypted production snapshot. On 27 October 2026 it passed migration
006 to 012 with preserved metadata and idempotent replay, while
production remained on 006. Offsite full restore is still required
before live migration.
