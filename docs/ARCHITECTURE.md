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
