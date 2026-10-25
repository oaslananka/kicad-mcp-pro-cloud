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
