# Cloud owner authorization: real-device acceptance gate

Status: **NO-GO** (29 October 2026). Scope: `oaslananka/kicad-mcp-pro-cloud`
draft PR #64 only. This is a **human/physical acceptance plan**, not proof
that the production connector is available, and not a request to turn it on.

## Verified evidence (do not substitute synthetic tests for human proof)

| Surface | Evidence | Accepted? |
| --- | --- | --- |
| Cloud production health | `/health` returns `status=ok`, production revision `9bfc760`, `remoteConnector=not_implemented` | Existing production only |
| Production login | `GET /sign-in` serves a real first-party GitHub login option; anonymous `/devices` redirects | Existing Cloud identity only |
| Independent owner passkey origin | Current Cloud `GET /owner-passkey/register` returns 404; no independent authority has been deployed | **NO** |
| Independent Better Auth session | Draft-only verifier and isolated HTTPS/PostgreSQL tests reject forged, expired, revoked and non-owner sessions | Synthetic only |
| Full approval chain | Chrome virtual passkey + four isolated PostgreSQL roles successfully register, activate, approve and consume once | Synthetic only |
| Local KiCad engine on a test workstation | KiCad CLI 10.0.7 loaded a disposable board; `pcb drc --format json` reported 0 violations / 0 unconnected items | Local CLI only |
| Cloud ↔ KiCad live remote read | No real device connection, physical owner confirmation or live `project_summary` round trip | **NO** |
| Separate daily offsite backup | `kicad-cloud-offsite.timer` not installed on VPS at last checked state | **NO** |

**Never interpret the local KiCad CLI check as Cloud-to-KiCad end-to-end
acceptance.** The only supported Cloud remote operation under review is
`project_summary` **presence flags**. Do not request or expose file contents,
DRC/ERC details, board edits or manufacturing operations.

## Required before a real-owner acceptance session

1. **Independent owner authority.** Choose and register a dedicated
   HTTPS origin and a separate GitHub/Google social OAuth application with
   an exact redirect URI for **that** origin. Do not reuse the Cloud public
   origin, Cloud Better Auth secret, Cloud login cookie or live OAuth
   client registration as a shortcut. Keep credentials in approved secret
   storage; do not place them in PRs, chat logs or shell output.
2. **Explicit separate server configuration.** Run the owner authority
   with its **own** identity database, session cookie, approved owner account,
   CSRF HMAC key and access-limited registration/activation/issuer database
   identities. No service is currently deployed; draft classes and test
   callbacks do not constitute a production-capable server.
3. **Independent enrollment and activation.** The actual owner signs in
   using the registered social provider and physically creates a passkey
   with user verification. Verify it is registered **inactive** and has
   issued zero project-read receipts. A separately authenticated authority
   explicitly approves activation, requiring a **fresh** passkey assertion.
   The registration SQL role cannot activate, and activation cannot issue
   a project-read receipt.
4. **Single approved scope.** Using the actual approved OAuth client and
   paired local KiCad device, display the exact owner, OAuth client,
   device, project, origin, `project_summary` and expiry. Obtain explicit
   physical passkey confirmation *for that particular request* and verify
   precisely one one-use receipt with exactly matching identities and
   deadline. Replaying or changing client, project, device, operation or
   origin must fail.
5. **Actual device round trip.** From the allowed private ingress, bring
   up a real authorized local KiCad connector on the test workstation and validate one
   metadata-only response through Cloud WSS. Kill/revoke the device and
   confirm no further read. An unmounted consent port or a disconnected
   client is a **denial**, not permission to bypass the gate.

## Negative tests that must pass with real independent identities

- Anonymous, expired, revoked, wrong-owner or unverified Better Auth session
  cannot load owner review or create a registration challenge.
- Browser Origin/Host/CSRF mismatch, misleading forwarded headers and
  caller-provided owner IDs do not authenticate.
- Unenrolled/inactive passkey cannot issue read approval; failed assertions
  consume their challenge and cannot be replayed.
- Approving one scope cannot authorize a different project, OAuth client,
  device, operation or expiration; consumed receipts cannot be re-armed.
- The connector remains deny-by-default with absent issuer, database role,
  device, trusted ingress, session or consent receipt; any failure preserves
  the existing production service.

## Release decision

**NO-GO until all required real-identity and physical-device proofs exist.**
The person performing acceptance must record date, exact tested Cloud SHA,
approved independent authority origin, device and project IDs **without
secrets**, test results and the evidence of explicit human presence.
Only then review #64 for ready-for-review and merge through normal
protected-branch checks. No automatic merge or `CONNECTOR_WS_ENABLED`
change follows from a passing *synthetic* test.

No production writes, DNS/OAuth app creation, support tickets, emails or
changes to another repository are authorized by this document.

## Independent owner service acceptance executable (draft-only)

The Cloud draft now contains a **separate HTTPS acceptance listener**, not a
production MCP route:

- `src/owner-acceptance-server.ts`: isolated first-party Better Auth social
  sign-in, session check and **inactive-only** passkey registration.
- `src/owner-acceptance-cli.ts`: explicit-secret, loopback-only entry point.
  Build with `npm run build`; launch with `npm run owner:acceptance` from
  a privately configured working tree. The built client JavaScript is copied
  into `dist` and served from that process.
- The process exposes only `/sign-in`, `/account`,
  `/auth/start/github`, the selected Better Auth callback/session/sign-out
  endpoints, `/owner-passkey/register`, its two registration POSTs,
  its JavaScript and a deliberately labeled local health endpoint.
  **There is no activation endpoint, approval-issuance API, WebSocket
  upgrade or KiCad read on this acceptance listener.**
- `test/owner-read-better-auth-session-http.test.ts` exercises the **actual
  composed HTTPS server**, an isolated Better Auth session and registration
  handler. It verifies signed owner session, wrong Host, invalid CSRF and
  session revocation; rejects `/api/auth/oauth2/token` and connector routes.

The launcher rejects missing configuration, unsafe DB privileges, reusing
the identity DB credentials for registration, non-HTTPS origins and weak
owner/CSRF parameters. **No secrets were provisioned or services started
on any real shared host by this change.** Required runtime configuration
is provided **only through an approved private secret manager**:

| Key | Purpose |
| --- | --- |
| `OWNER_ACCEPTANCE_ORIGIN` | Distinct exact HTTPS origin for the owner authority |
| `OWNER_ACCEPTANCE_PORT` | Dedicated TLS listener port (1024–65535), bound to `127.0.0.1` |
| `OWNER_ACCEPTANCE_TLS_CERT_FILE`, `OWNER_ACCEPTANCE_TLS_KEY_FILE` | Trusted certificate and key readable by the owner listener |
| `OWNER_ACCEPTANCE_IDENTITY_DB_URL` | Isolated Better Auth identity database with migrated tables |
| `OWNER_ACCEPTANCE_REGISTRATION_DB_URL` | **Different** least-privilege DB account for 013–018 passkey tables |
| `OWNER_ACCEPTANCE_GITHUB_CLIENT_ID`, `OWNER_ACCEPTANCE_GITHUB_CLIENT_SECRET` | Independently registered GitHub OAuth app; callback `<owner-origin>/api/auth/callback/github` |
| `OWNER_ACCEPTANCE_BETTER_AUTH_SECRET` | Independent Better Auth signing/encryption secret |
| `OWNER_ACCEPTANCE_OWNER_SUB` | Exact approved identity user ID; all other accounts denied enrollment |
| `OWNER_ACCEPTANCE_CSRF_KEY` | Independent 32+-byte random base64url key |

A separate, explicitly reviewed TLS-preserving ingress route would be
necessary for a remote OAuth provider to reach a loopback listener; the
current Cloudflare/production ingress is **not** automatically reused,
modified or approved. For first owner bootstrap, a deliberately nonmatching
allowlisted ID may be used while authenticating an account; inspect that
account's own `/api/auth/get-session` over a trusted connection, configure
its actual verified `user.id`, then restart the listener. No passkey
registration may succeed while the owner allowlist does not match.

This is an executable step toward real enrollment, **not successful human
OAuth sign-in/physical passkey acceptance**. Only a real owner performing a
login and biometric/PIN verified browser registration against the
independent host can close those blockers. No environment secrets, OAuth
apps, DNS, physical tokens or production DB roles are automatically created.

### Independent GitHub OAuth first-leg validation (synthetic client)

The composed HTTPS acceptance server now has an automated real first-leg
GitHub OAuth redirect contract in
`test/owner-read-better-auth-session-http.test.ts`. A signed-in user
is **not** simulated for this step: the first-party form POST is sent over
validated local HTTPS, passed through Better Auth's actual
`/api/auth/sign-in/social` handler, and must return **303** with a redirect
to `https://github.com/login/oauth/authorize`. The test asserts the
configured synthetic client ID, the exact independent issuer callback
`<owner-origin>/api/auth/callback/github`, an issued browser-state cookie
protected by `HttpOnly`, `Secure`, `SameSite=Lax`, and denial of forged
Origin / direct GET. No browser state tokens, cookies or OAuth secrets are
printed in test output. This proves **only OAuth initiation**, not a GitHub
callback, an actual owner session, a real OAuth app or human passkey acceptance.
