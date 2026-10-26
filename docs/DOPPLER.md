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
