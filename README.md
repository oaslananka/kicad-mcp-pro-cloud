# KiCad MCP Pro Cloud

A remote, authenticated MCP resource server and future account/device control plane for [KiCad MCP Pro](https://github.com/oaslananka/kicad-mcp-pro). KiCad files, local project paths, native tool execution and design changes stay on the user's workstation.

**Status: foundation preview, not a complete ChatGPT/Claude product.** Signup, a running OAuth authorization server, device enrollment/relay, live KiCad execution, write tools and the user dashboard do not exist yet. Never advertise these as implemented.

## What's implemented

- Official TypeScript MCP SDK v2 (MCP 2026-07-28), stateless Streamable HTTP at POST /mcp.
- OAuth 2.1 resource-server boundary: protected-resource discovery, external JWKS JWT verification with issuer, audience and scope restrictions; anonymous inventory is never served.
- Four read-only tools: get_service_status, list_devices, list_projects, get_project.
- PostgreSQL metadata-only inventory (opaque IDs and project aliases, no project files or paths); per-owner filtering, disabled-project filtering, composite FK enforcing same device owner.
- Strict Host/Origin checks, request limits, read-only annotations, unit, wire-level HTTP and PostgreSQL integration tests.

## Development

Requires Node.js 24+ and an isolated PostgreSQL instance. The service does NOT have a magic development token or auth bypass.

1. Run npm ci.
2. Apply db/001_inventory.sql through a controlled DB migration/admin step.
3. Set environment variables (see .env.example) in your runtime.
4. Start the service with npm start.
5. Execute npm run check.

The .env example is documentation only; it is not automatically loaded. Real OAuth issuer, JWKS endpoint, audience, database and HTTPS reverse proxy must be configured before any public exposure.

Run PostgreSQL integration tests against a disposable DB with TEST_DATABASE_URL set. CI runs those tests against an ephemeral PostgreSQL service.

The public root is deliberately a static status page, not a simulated login. Protected-resource metadata at /.well-known/oauth-protected-resource supports MCP client discovery but cannot substitute for a configured OAuth authorization server.

## Boundaries

- Read docs/ARCHITECTURE.md for the protocol, security contract and repo ownership.
- Read docs/ROADMAP.md for delivery gates that remain unimplemented.
- The local repository is not changed in this milestone.
- Neither Project CRUD nor device registration is exposed until pairing and revocation design is verified.

Official references:
- https://modelcontextprotocol.io/specification/2026-07-28
- https://ts.sdk.modelcontextprotocol.io/v2/serving/http
- https://developers.openai.com/plugins/build/auth
