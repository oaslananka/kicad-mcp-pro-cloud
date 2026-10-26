# Cloud boundary (2026-10-26)

## Two repositories, one KiCad implementation

- `oaslananka/kicad-mcp-pro`: local stdio/HTTP MCP engine, KiCad IPC/CLI, per-project permissions, project paths and Tauri client.
- `oaslananka/kicad-mcp-pro-cloud`: remote MCP resource server, identity verification, metadata inventory, user portal and eventual outbound device relay.
- The local project root is **never** inferred from a Cloud-supplied string. The Cloud stores opaque project/device IDs, alias, enabled policy, and status only.
- No Cloud file upload, arbitrary file operations or raw 387-tool forwarding.
- Native KiCad tools, annotations and engineering skills remain owned by the local repository. Cloud builds a small stable task-oriented MCP interface.

## First foundation slice

An authenticated HTTP MCP endpoint and PostgreSQL read-only device/project catalog. In the absence of enrollment, both catalogs correctly return no records. No remote KiCad, OAuth authorization server, account signup, websocket connector, local mutations or hosted UI is implemented yet.

Identity provider must issue OAuth 2.1 PKCE tokens with `iss`, `aud`, `sub` and `projects:read` scope. Cloud verifies JWT against an HTTPS JWKS, not via an unvalidated token decode. OAuth protected-resource discovery is hosted at the well-known endpoint. Configure an external OAuth provider with standards-compliant metadata and ChatGPT/Claude-compatible client registration. **This repo does not generate access tokens, store refresh tokens or run user login.**

The protocol is implemented with stable MCP TypeScript SDK v2 (2026-07-28) using a new stateless handler per request; legacy compatible clients are handled by SDK. All requests require authentication, including tool discovery. A user can only list projects owned by their token `sub`, and get-by-ID additionally checks ownership.

## Security invariants

1. Unauthenticated and invalid-token MCP calls fail closed before SDK execution. Production configuration requires an HTTPS public origin and explicit identity provider configuration.
2. The verified access token has a pinned issuer, audience, allowed signature algorithms, expiration and necessary scope. Never treat a GitHub/Google ID token as an MCP access token without verifying its resource audience.
3. Client-supplied project IDs cannot select another user's project, including through a device owned by another user.
4. Disabling a project must eventually block *execution*, not merely hide the project from the list. That enforcement must occur in Cloud and again locally before remote writes are enabled.
5. Do not expose Cloud enrollment APIs until pairing credentials, device authentication, revocation and cross-owner protections have dedicated tests.
6. No work is queued while devices are offline. No eventual remote write is available in this slice.
7. Never log bearer tokens, local absolute paths, KiCad project content, unredacted tool arguments or design analysis responses.
8. This service requires externally terminated HTTPS and controlled reverse-proxy Host/Origin forwarding before any public deployment; in-process protection is defense in depth.

## Version and deployment policy

Local backend contracts are versioned independently of Cloud releases. Build/read-only tools will later dispatch only reviewed effects to a capability-matched connected local engine. Real-client MCP smoke tests and a signed local connector are needed before publishing. See `docs/ROADMAP.md`.

Sources:
- https://modelcontextprotocol.io/specification/2026-07-28
- https://ts.sdk.modelcontextprotocol.io/v2/serving/http
- https://developers.openai.com/plugins/build/auth

## Issue #2 incremental boundary: per-client project grants

A verified OAuth access token now needs a signed client_id claim, along with
the existing issuer, audience, expiry, user subject and projects:read scope.
A project is visible to an MCP client only if user, device, project and the
explicit client-specific grant all match and are enabled. Unapproved clients
discover zero projects and zero devices (default deny).

Cloud implements a small management-only endpoint:
PUT /api/v1/projects/{project-uuid}/grants
JSON: {"clientId":"registered-oauth-client","enabled":true,"maxMode":"readonly"}.

This endpoint requires projects:read AND projects:manage, and signed client_id
must equal MANAGEMENT_CLIENT_ID configured exclusively in Doppler. It accepts
strict JSON only; absolute project paths and arbitrary extra attributes fail.
The transaction checks owner, project maximum mode, appends a metadata-only
audit event, and rejects foreign or nonexistent projects without revealing
their identity. The production IdP must map actual client identity to a
signed client_id claim. Do not let callers self-declare that claim.

Manufacturing and editing modes are not interchangeable super-roles:
when project/grant modes differ, discovered policy falls back to readonly.
Project-level enable/disable, server-side local enforcement and runtime
KiCad operations are not implemented in this increment.

There is still no actual OAuth authorization server, browser signin,
device pairing, persistent relay, local KiCad activity or production UI.
The public endpoint remains unusable until the approved provider exists.

## Better Auth prototype (not production-ready)

A Better Auth 1.7.13 module composes jwt, mcp and CIMD using the MCP 2026-07-28
profile. It is available only when AUTH_MODE=builtin is set; external issuer
mode remains the default. Node routes the auth API and authorization-server
metadata to Better Auth while retaining the resource-bound MCP API.

The available modules include Google and GitHub provider adapters, encrypted
stored account tokens, implicit-linking disabled, RS256 JWKS, staged rotation
and a reviewed generated schema (db/003_better_auth.pgsql). Real provider
authorization-code callbacks, interactive consent, PKCE with real AI clients,
first-party session authorization, token audience compatibility and account
link/revoke are NOT yet demonstrated. Provider credentials stay in Doppler.
No public login or deploy is enabled by this commit.

The OCI image is unprivileged and contains compiled application code only.
See infra/README.md for IaC/deployment adoption boundaries. There is no
presumption that running a container equals validated release.

## Web login entry point (Cloud-only increment)

The optional builtin provider has a minimal /sign-in HTML page with Google
and GitHub buttons and a session-protected /account page. The first-party
POST /auth/start/:provider checks exact Origin, validates form input, verifies
signed OAuth continuation parameters and uses Better Auth to obtain the real
social authorization URL and HttpOnly state cookie. Only expected Google or
GitHub HTTPS authorization destinations are allowed; a user-supplied redirect
URL is not accepted.

The HTML has restrictive CSP, no-store, no-referrer and escaped user content.
There is no OAuth consent page yet. This is not full social login acceptance
or real callback/token-exchange evidence. AUTH_MODE defaults to external.

## OAuth consent increment (Issue #2, not production)

The optional built-in provider now offers a minimal server-rendered /consent
screen. It validates the exact Better Auth signed and unexpired OAuth query,
requires an authenticated user, resolves the public OAuth client from the
provider database, and displays all requested scopes and optional claims.
No KiCad projects are automatically shared by OAuth consent.

The approval/denial POST uses a short-lived CSRF HMAC bound to the current
user, signed request, nonce and timestamp. It additionally checks the same
browser Origin and rejects extra form fields, modified requests and unknown
clients. Only a first-party OAuth client configured in Doppler as
MANAGEMENT_CLIENT_ID can request the projects:manage scope. The server delegates
both approval and denial to Better Auth's OAuth consent endpoint; it does not
mint, store or forge access tokens. The destination is subject to the
authorization server's own client/redirect validation plus a restricted
HTTP(S) redirect check.

No production client is registered, no real Google/GitHub callback, no
browser-based consent acceptance with ChatGPT/Claude, and no user-facing
consent revocation UI have yet been proven. Auth remains disabled by default.
Revoking an OAuth consent does not by itself immediately invalidate an
already-issued bearer token: project-client grants also need revocation to
prevent continued authorized project discovery or execution.

### Safe consent page rendering

The consent form uses React 19 server-side rendering with no client-side
JavaScript. OAuth client names, scopes, claims and signed form values are
passed as text/attribute values so framework escaping is applied before
HTML serialization. CSP denies script execution and third-party resources.
This adds no new frontend service or single-page application.

## Per-user connection revocation (Issue #2 incremental)

An authenticated account can list OAuth consents on /connections, using
Better Auth's getOAuthConsents with the active session. For POST
/connections/revoke, the server checks session identity, exact Origin, the
consent's owner and client, and a short-lived, same-site, user/session/client/
consent-bound CSRF signature. Server-side HTML rendering escapes client
metadata. No OAuth bearer token or KiCad local path appears in HTML.

Revocation is deliberately fail-closed and ordered:
1. In PostgreSQL, disable ALL project grants for that authenticated owner
   and OAuth client, recording only metadata audit entries.
2. Only after that transaction commits, call Better Auth deleteOAuthConsent
   using the user's session. On a failed deletion, report an error and keep
   project grants disabled.

Already issued stateless JWT access tokens cannot be individually revoked
by deleting OAuth consent. The Cloud's read tools must continue checking the
live grant rows on every invocation; this ensures previously signed JWTs
cannot discover projects after grant revocation. Future remote execution
must enforce identical current grants and permissions, not just token scope.

This design does not claim refresh-token family revocation, a token denylist,
device disconnection, or realtime remote execution cancellation. Those need
separate acceptance tests before public production launch.

## Built-in OAuth token lifecycle hardening (Issue #2)

Connection revocation now creates/updates a per-owner-and-OAuth-client cutoff
timestamp in client_token_cutoffs as part of the same transaction that disables
the client's project grants. The Cloud resource server requires the signed JWT
iat claim, then queries the current cutoff for every MCP request and every
first-party grant-management mutation. Tokens issued in or before the UTC
second of that cutoff are rejected, including after the user reconnects and
re-enables project grants. Tokens issued within the cutoff second may need a
new authorization after the following second; fail-closed is intentional.

With the optional BUILTIN identity issuer enabled, the same database transaction
also marks matching Better Auth oauthRefreshToken and oauthAccessToken
records revoked and clears cached refresh rotation responses and expiry.
This protects even already-rotated refresh token rows when a reuse window is
enabled. Filtering is by BOTH current authenticated user and OAuth client,
never by client alone. The external-issuer mode cannot mutate tokens it did not
issue; its client-specific cutoff and grant denial still apply at THIS MCP
resource server.

This SQL is intentionally coupled to the PINNED Better Auth 1.7.13 schema.
Do not upgrade the provider before verifying the actual refresh, rotation,
introspection and revocation behavior and migrating safely. An in-flight
refresh request concurrent with revocation cannot be declared fully excluded
without an end-to-end concurrency test. Cloud access is checked online for
every request, but this does not terminate an operation already in progress
or revoke tokens accepted by other downstream resource servers.

The db/005_token_cutoff.pgsql migration must run before deploying this
resource server version. There are no automatic startup migrations. Any
database outage at the authorization check returns a fail-closed error.
Auth mode remains external by default; no live OAuth provider was enabled.
