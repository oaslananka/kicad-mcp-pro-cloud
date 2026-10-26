# Doppler-only runtime configuration policy (2026-10-26)

## Source of truth

Doppler project: kicad-mcp-pro-cloud. The UI currently shows a main config.
Protect staging and production via separate Doppler configs and restricted
read-only config-scoped service tokens. main is NOT assumed to be production.

The ONLY user-defined GitHub Actions repository secret is DOPPLER_TOKEN.
No DB URLs, OAuth client secrets, JWT keys, tokens, passwords or certificates
may be committed, copied to GitHub repository secrets/variables, or embedded
in deployment manifests, Docker build arguments or .env files.
The automatic GitHub-provided GITHUB_TOKEN is separate from user secrets.
CI's disposable test database password is a public test fixture, not a real secret.

Do not set up Doppler's GitHub Secrets synchronization for this repository:
it would duplicate secrets into GitHub and break the policy.

## Required runtime key names (values ONLY in Doppler)

PUBLIC_ORIGIN  - public HTTPS website/MCP origin
OAUTH_ISSUER   - HTTPS issuer of future authorization service
OAUTH_JWKS_URL - HTTPS key endpoint for access-token verification
OAUTH_AUDIENCE - exact resource URI: public origin followed by /mcp
DATABASE_URL   - PostgreSQL connection string for a provisioned database
HOST           - optional bind interface, defaults to loopback
PORT           - optional server port, defaults to 8787
ALLOWED_ORIGINS - optional exact allowed HTTPS browser origins\nMANAGEMENT_CLIENT_ID - OAuth client_id of the first-party management UI, empty disables write API

Never fill missing DB or OAuth details with invented production values.
As of this change an OAuth authorization server, persistent database and TLS
reverse proxy have NOT been deployed or proven.

## Runtime and CI

After securely authenticating Doppler CLI and selecting a specific config,
run the following commands (no local .env or plaintext secret file):

    npm ci
    npm run build
    doppler run -- npm run config:check
    doppler run -- npm start

If necessary select project and config explicitly with CLI flags
(-p kicad-mcp-pro-cloud -c YOUR_CONFIG). A restricted config-bound service
token can avoid interactive selection.

Normal PR CI uses only disposable tests and NO Doppler credentials.
The separately manually triggered Doppler Configuration Validation workflow
fetches configuration at runtime with the sole GitHub secret DOPPLER_TOKEN.
Run it ONLY on trusted reviewed code on the default branch; never on a PR.
A read-only, config-scoped token is required, not a personal/admin token.

Doppler run does not automatically mask values in GitHub Actions logs.
Do not print environment, run shell tracing, persist fetched secrets to files,
or add commands which echo configuration. Current config checker prints only
a fixed success string. Rotate compromised service tokens in Doppler.

Before production: verify TLS/Origin/Host proxy, OAuth provider, durable
PostgreSQL with backups and restore, least-privilege Doppler access, rollback,
and real host/client connection tests. Do not expose Doppler tokens to UI.

Official:
https://docs.doppler.com/docs/service-tokens
https://docs.doppler.com/docs/cli
https://www.doppler.com/blog/remove-hardcoded-secrets-github-actions

New configuration name: MANAGEMENT_CLIENT_ID. This must be the signed
OAuth client_id of the first-party web management application, not ChatGPT.
If unset, all management mutations fail closed. Its value belongs only in
Doppler. Do not invent a provider client id before client registration.

## Built-in identity foundation (disabled until verified)

A Better Auth authorization server is optional. AUTH_MODE defaults to external.
For test/staging, AUTH_MODE=builtin requires BETTER_AUTH_SECRET and real values
for GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID and
GITHUB_CLIENT_SECRET. All these static runtime credentials must live in Doppler.

With built-in auth, OAUTH_ISSUER must equal PUBLIC_ORIGIN + /api/auth and
OAUTH_JWKS_URL must equal PUBLIC_ORIGIN + /api/auth/jwks. OAUTH_AUDIENCE
remains PUBLIC_ORIGIN + /mcp. Missing or mismatched settings cause a startup
error; there is no anonymous login bypass.

Social OAuth callback URI patterns:
- https://kicad-mcp-pro.oaslananka.dev/api/auth/callback/google
- https://kicad-mcp-pro.oaslananka.dev/api/auth/callback/github

Use provider registrations specific to each environment. The built-in option
does not claim that Google/GitHub registrations or full consent/UI are ready.
The social account linking policy disables implicit email-based account
linking; the intended UX will let an authenticated user link a second provider.

Better Auth encrypts social OAuth tokens before persisting them. JWT signing
private keys are encrypted using the Doppler-supplied auth secret and stored in
the protected PostgreSQL database, not in Doppler itself. Dynamic user sessions,
grant records and provider tokens necessarily live in application storage.
Doppler is the source of STATIC runtime configuration and cryptographic root
secrets; protect/backup the database as sensitive data.

The existing resource verifier rejects proof-of-possession-bound (cnf) tokens
until an actual DPoP proof validator is integrated. Do not advertise DPoP
compatibility. Review OAuth provider schema migration
(db/003_better_auth.pgsql, pinned Better Auth 1.7.13) and apply only in a
controlled migration step; the server never auto-migrates in production.

OCI image builds use no secret. A verified runtime mechanism must inject
Doppler configuration; do not pass static secrets as Docker build args, export
them to plan/state output or echo them to deployment logs.

## Token-cutoff DB migration and provider coordination

No new Doppler secrets or GitHub Actions secrets were introduced. Deploy
db/005_token_cutoff.pgsql before running an updated Cloud resource server.
Both external and built-in modes need the cutoff table; built-in mode also
needs the reviewed Better Auth tables in db/003_better_auth.pgsql.

User/client revocation in built-in mode directly updates that pinned schema's
refresh/opaque token records, including clearing rotation replay caches.
This needs staging validation against Better Auth 1.7.13 on every provider
upgrade. Never use this to manipulate accounts in another provider's database.
JWT cutoffs must not be replaced by naive deletion of signed token strings.

## Schema version 006 preflight

Migration db/006_oauth_issuance_fence.pgsql must be applied after 005 and
before any deployment enabling AUTH_MODE=builtin. It installs the built-in
provider issuance/replay fence against revoked client grants. No additional
secret is needed. It remains forbidden to enable production public OAuth
without real-provider login/consent and host interoperability acceptance.
Review pinned Better Auth schema, database backup and staging restore first.
