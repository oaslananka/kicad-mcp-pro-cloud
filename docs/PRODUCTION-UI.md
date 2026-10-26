# Production-first web experience

KiCad MCP Cloud uses one server-rendered design system for public overview,
Google/GitHub sign-in, OAuth consent, account, and AI connection revocation.
The UI is responsive, keyboard accessible, and reduced-motion aware. Styles
are served from /assets/ui.css on the same origin and container, without
external fonts, client JavaScript, new service or additional Docker image.

All external text is escaped by React SSR. Existing signed OAuth requests,
CSRF validation, exact Origin, permissions and restrictive CSP are preserved.
Without explicitly enabled builtin identity, sign-in and account navigation
remain disabled. No live local device connector or KiCad project access is
presented as finished.

## Direct production release policy

Production deployment only; no staging environment and no retained
rollback application image. Retain one active application image named
kicad-mcp-pro-cloud:production. PostgreSQL and existing Cloudflare tunnel
base images are separate service dependencies. Never run a global Docker
image prune, since the VPS hosts other services.

Before public login enablement: dedicated production PostgreSQL with backup
and restore, verified schema migrations 001-006, HTTPS domain routing, a
production Doppler config with Google/GitHub OAuth credentials and Better
Auth secret, valid issuer/JWKS/resource audience, live client acceptance
and separate local device pairing acceptance.

A successful health endpoint or landing page does not imply OAuth is
usable or remote KiCad execution is implemented.
