# Direct production OAuth acceptance — no staging environment

Status as of 2026-10-26: the production Cloud UI and protected remote MCP
gateway are online at https://kicad-mcp-pro.oaslananka.dev. The direct
production setup uses one KiCad application image and an isolated database
volume; there is no persistent staging deployment or rollback app image.

## Live verified checks

- HTTPS /, /health, /assets/ui.css and OAuth resource discovery: 200.
- Anonymous POST /mcp: 401. Unreleased /sign-in: 404.
- PostgreSQL and application: both Docker healthy.
- Production Doppler project/config: kicad-mcp-pro/prd_cloud.
- All six reviewed database migrations applied.
- No Docker ports published for the database or Cloud app.
- Real local KiCad device enrollment/relay and live engineering tool execution
  are NOT implemented. Do not claim they are available.

## Synthetic, real-protocol checks already passed

The test at test/oauth-pkce-flow.test.ts exercises the actual Cloud HTTP
handler, Better Auth 1.7.13 and disposable PostgreSQL 17. It verifies:
- anonymous authorization redirects to signed sign-in;
- Google/GitHub login initiation preserves signed parameters, but DOES NOT
  complete any live provider callback;
- synthetic authenticated consent and exact callback state;
- authorization code exchanged with S256 PKCE and MCP audience;
- reusing a code and an incorrect verifier for a fresh code are rejected.

## Remaining direct production activation gates

1. Register the production Google OAuth Web client with authorized redirect:
   https://kicad-mcp-pro.oaslananka.dev/api/auth/callback/google
2. Register the production GitHub OAuth App with callback:
   https://kicad-mcp-pro.oaslananka.dev/api/auth/callback/github
3. Store GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID,
   GITHUB_CLIENT_SECRET only in Doppler config prd_cloud. BETTER_AUTH_SECRET
   already exists in that config. GitHub Secrets contains only DOPPLER_TOKEN.
4. Review a production-safe explicit AUTH_MODE=builtin activation change;
   the initial production Compose intentionally fixes AUTH_MODE=external.
   The user should not be able to sign in before the credentials, issuer,
   sessions, redirect/cookie security and OAuth client integration work.
5. Verify real Google and GitHub login/callback state, exact consent scopes,
   session cookies, cancel/expiry/replay rejection, identity/account linking,
   authorization-code PKCE, access token scope and downstream revocation.
6. Pair a real ChatGPT MCP client and Claude MCP client. Test metadata/client
   identification, token exchange, refresh rotation, disconnect, stale-token
   denial and new authorization. Gemini/Grok compatibility is conditional on
   their actually supported current MCP client APIs.
7. Do not expose live remote KiCad project execution until the local
   connector/device pairing and per-project authorization have been
   implemented and explicitly tested in kicad-mcp-pro. No local project files
   should be uploaded to Cloud; authorized text/tool output may go to the
   user's selected AI provider and must be disclosed.
8. Preserve non-secret logs and independent acceptance evidence. Keep
   GitHub Issues #2 and #9 open until their complete criteria pass.

## Production data recovery

Continuous local encrypted snapshot capability and remote offsite recovery
have separate requirements. A single same-host encrypted archive is not
sufficient for disaster recovery and archive parsing is not a full restore.
See infra/PRODUCTION-DEPLOY.md. No staging, extra app images or automatic
schema migrations are required for this deployment model.
