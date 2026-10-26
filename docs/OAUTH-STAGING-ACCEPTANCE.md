# OAuth and social sign-in staging acceptance

Current status: real Better Auth OAuth 2.1/PKCE protocol checks with synthetic
identities and a disposable local PostgreSQL instance. NOT yet a real
Google/GitHub login or an approved ChatGPT/Claude host integration.

## Verified locally

The test file test/oauth-pkce-flow.test.ts uses the actual Cloud HTTP server
and Better Auth 1.7.13 with a disposable PostgreSQL 17 schema.

- Anonymous authorization goes to a signed sign-in screen, no access granted.
- The original signed authorization parameters survive the Google and GitHub
  login *initiation* and generate only allowlisted provider redirects with
  HttpOnly state cookies. External callbacks are NOT followed.
- An authenticated synthetic user sees the explicit consent form.
- Approval returns an authorization code and the unchanged OAuth state at
  the precisely registered redirect URI.
- An S256 PKCE verifier exchanges the code at the actual token endpoint.
  The access token audience includes the MCP resource and offline access
  supplies a refresh token.
- Reusing the authorization code fails. A fresh code is rejected when
  presented with a mismatching PKCE verifier.

## Remaining real staging gates

1. Choose an isolated private HTTPS PUBLIC_ORIGIN and database. Perform
   migration 001-006 review, backup, restore drill and rollback acceptance.
2. Create separate staging Google OAuth Web and GitHub OAuth app credentials.
   Register the exact callback URLs:
   - PUBLIC_ORIGIN/api/auth/callback/google
   - PUBLIC_ORIGIN/api/auth/callback/github
3. Keep GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID,
   GITHUB_CLIENT_SECRET and BETTER_AUTH_SECRET in staging Doppler only.
   GitHub Actions retains just DOPPLER_TOKEN. Do not log secrets.
4. Leave publicly accessible OAuth disabled. Use AUTH_MODE=builtin only on
   the isolated staging issuer and verify issuer/JWKS consistency.
5. Test real social callbacks, browser session/cookie, account linking,
   authorization-code continuation, expired/replayed state, cancellation,
   explicit scopes and consent. Do not open public sign-up yet.
6. Connect ChatGPT and Claude as real MCP clients and test discovery, CIMD
   where supported, PKCE, token refresh/replay, disconnect, stale access
   rejection and fresh reconnection. Add Gemini/Grok only after checking
   each host's actual current capabilities and requirements.
7. Verify the separation between local KiCad project files and Cloud
   metadata. Remote device pairing and KiCad execution are NOT implemented.
8. Preserve non-secret acceptance evidence and keep Issues #2 and #9 open
   until the remaining gates pass.

No production migration, deployment or OAuth credential setup is performed
by this test. Runtime Doppler secrets remain externally managed.

Official references:
https://better-auth.com/docs/plugins/oauth-provider
https://better-auth.com/docs/plugins/mcp
https://better-auth.com/docs/authentication/google
https://better-auth.com/docs/authentication/github
