# Cloud owner authorization: real-device acceptance gate

Status: **NO-GO** (29 October 2026). Scope: `oaslananka/kicad-mcp-pro-cloud`
draft PR #64 only. This is a **human/physical acceptance plan**, not proof
that the production connector is available, and not a request to turn it on.

**Pilot scope clarification:** The separate hardware passkey issuer below
describes the original higher-assurance per-request approval path. The
independently disabled `CONNECTOR_OPERATOR_ONESHOT_ENABLED` Cloud pilot
uses the existing owner OAuth/browser project grant and a manually launched
one-shot local connector for **presence flags only**. No second OAuth
application, dedicated domain or passkey server is required for that limited
scope. The pilot does **not** claim fresh independent human verification;
all device signature, authorization, revocation and physical one-shot
acceptance requirements still apply before production enablement.
See `docs/CONNECTOR-WEBSOCKET-BOOTSTRAP.md`.

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

### Real compiled acceptance-process / PostgreSQL role smoke test

`test/owner-acceptance-cli.test.ts` runs the actual compiled
`dist/owner-acceptance-cli.js` process with short-lived, randomly generated
credential passwords for **two distinct PostgreSQL login roles**, not a
mocked in-process router. On a disposable PostgreSQL 17 schema, the
independent identity login has access to Better Auth's tables and the
registration login has only the exact columns/operations required for
inactive credential enrollment. The test uses certificate-validated HTTPS
on loopback, proves that the health endpoint reports the connector,
approval and activation as disabled, and verifies that the compiled
acceptance process accepts a genuinely signed Better Auth session cookie.
A valid owner session starts one registration challenge; a revoked session
cannot reuse the same cookie/CSRF token, and no credential or project
approval is created by requesting an enrollment challenge.

The test generates TLS certificates, role passwords, owner session and
issuer configuration only in the disposable environment and deletes them
after completion. It does not use production OAuth credentials or contact
GitHub. **Chrome-based virtual WebAuthn attestation remains independently
covered by the browser registration tests**, not this process-launch smoke
test. Consequently this still does not demonstrate a human's passkey,
OAuth provider callback, or a physical KiCad WSS read. Real-owner NO-GO
conditions remain unchanged.

### Compiled HTTPS host with Chrome WebAuthn enrollment (virtual device)

The **same actual compiled** `dist/owner-acceptance-cli.js` integration
test now exercises the complete browser-side registration path. After
starting the server with two separately authenticated temporary PostgreSQL
roles, a verified Better Auth session, and trusted local HTTPS, it launches
system Chrome with a **virtual** CTAP2 authenticator capable of user
verification. Navigation does not silently register anything; only the
explicit **Register passkey** button launches `navigator.credentials.create`.
Chrome returns a signed attestation to the separately running HTTPS process.
The restricted registration SQL role persists precisely one credential for
the allowed test owner with `enabled=false`, and the approval ledger remains
empty. After revocation, the server rejects the former session and CSRF
rather than allowing a second registration challenge. All test credentials,
browser state, TLS files and SQL fixtures are discarded.

This eliminates the gap between separate browser and separate process-start
tests. The owner session and authenticator remain **synthetic**. No social
provider callback, physical passkey, independent public owner deployment or
Cloud-to-KiCad WSS acceptance has occurred, so the release remains **NO-GO**.

### Independent HTTPS approval review handler (unmounted)

The draft now contains `src/owner-read-review-http.ts`, a separate owner
review handler for a **future independently deployed** HTTPS issuer.
Unlike the passive-enrollment-only `owner-acceptance-cli`, this handler
does **not** run or expose any production route. A trusted in-process
caller must explicitly register one verified, exact
owner/client/device/project/origin/request-ID intent through
`addTrustedIntent(intent,credentialId)`; there is deliberately **no**
public HTTP request that creates, imports, or modifies that scope.
Trusted registration is bounded to 64 entries and a 30-second expiry.

For an existing trusted request, `GET /owner-read/review?requestId=...`
requires an independently verified owner session and renders the exact
scope with a session-bound CSRF proof. It calls the separate least-privilege
WebAuthn issuer to create a user-verifying authentication challenge for an
already **enabled** owner passkey. The owner must actively click the
approval button. Only `POST /owner-read/approval` from the exact HTTPS
Origin, with the original authenticated owner session, correct CSRF,
challenge and WebAuthn assertion, can ask the issuer to create one
PostgreSQL approval receipt. Submissions consume the in-memory review
intent once. Missing or forged session, incorrect Origin/CSRF, tampered
passkey signatures, replayed requests and wrong owner are denied.
The review JavaScript is included in the build output for a future
dedicated issuer deployment; it is **not** mounted on Cloud's HTTP router.

The isolated PostgreSQL/HTTPS integration test
`test/owner-read-review-http.test.ts` validates a real restricted issuer
login and synthetic P-256 signed WebAuthn assertion, exact SQL scope,
session enforcement, CSRF, one-time issuance, malicious signatures and
replay. The separate Chrome virtual authenticator UI tests continue to
cover deliberate click and user-verification behavior. **No real OAuth
provider session, physical passkey or independently authenticated
Cloud-to-owner trusted intent exchange exists yet.** These tests do not
authorize deployment, activation, merge or real local KiCad reads.

### Signed inter-service intent transport, synthetic acceptance

A DRAFT-only Ed25519 signed scope envelope now connects the Cloud
two-phase HTTP `/prepare` contract to the independent owner-issuer
`addTrustedIntent` method in a separate verified HTTPS process.
`test/owner-read-intent-transfer.test.ts` creates ephemeral Ed25519
sender/public verifier keys and localhost TLS, exercises actual HTTPS
delivery, checks exact scope and validates that forged, wrong-key,
modified, expired and concurrent replay requests cannot enroll a review
intent. `test/http.test.ts` additionally refuses a prepared read if
trusted owner delivery is not configured or failed.

The authoritative owner-credential selector runs in the independent
issuer's trust boundary, never with credential IDs provided by the OAuth
client or Cloud request. The two signing keys are roles, not secrets
committed to this repository: only Cloud may hold its Ed25519 *private*
signing key; the owner issuer is allowed only its *public* verification
key. Browser session authentication/CSRF/WebAuthn UV remains separately
required to produce the actual read receipt.

These signing/receiving pieces remain deliberately **unmounted** in real
runtime composition. This is synthetic HTTPS/cryptographic contract
acceptance only, **not** real GitHub OAuth login, human owner verification,
physical WebAuthn, independently deployed authority or local KiCad WSS
acceptance. Do not merge or enable remote reads.

### Real owner HTTPS host integration (opt-in, draft only)

The independent `createOwnerAcceptanceServer` now accepts an **optional
`approval` composition dependency** containing the separately verified
Cloud signed-intent intake and the session-protected review handler. When
provided by trusted server code, the *same exact-origin HTTPS server* routes
`POST /internal/owner-read/intent`, `GET /owner-read/review?requestId=...`,
the static review script, and `POST /owner-read/approval`. Its health reply
identifies `approval=webauthn_review_issuer`. Without this dependency, the
routes do not exist and its health reply remains `approval=disabled`.

**Importantly, the actual `owner:acceptance` executable does not supply
this dependency.** Its default, passive-only registration policy has not
been changed; it still rejects internal intent creation, review, approval,
passkey activation and connector operation. Production Cloud also never
mounts this issuer. The optional dependency is not a configuration toggle
that bypasses authentication or approves a read.

The isolated `owner-read-review-http.test.ts` now starts the **actual
owner acceptance HTTPS server**, a real Better Auth session stored in
PostgreSQL, a separate restricted SQL issuer login, the Cloud Ed25519 signer
and independently pinned public-key verifier. The complete synthetic
sequence accepts one exact Cloud-signed request, verifies the real
session/CSRF and P-256 WebAuthn UV assertion, and produces precisely
one SQL receipt for its immutable owner/client/device/project/origin scope.
It also denies an independently valid *different user's* Better Auth
session, revoked owner session, unsigned scope, wrong Origin/CSRF,
tampered signature and replay. None of the synthetic data represents
independent physical owner acceptance.

The remaining production boundary is explicit: securely provision an
independent owner deployment, an issuer-only SQL role and the pinned Cloud
verification key, then obtain real owner GitHub OAuth and physical passkey
approval. The existing passive acceptance CLI must not be enabled as
an approval issuer by inventing test credentials or switching flags.

### Dedicated independent owner issuer launcher (draft only)

The repository now contains a separate, default-deny owner:issuer executable.
This does not modify the existing passive-only owner:acceptance command, and
the production Cloud app and deployment do not invoke either issuer route.

Required private configuration, with no built-in credentials or defaults:
- OWNER_REVIEW_ENABLED=true, OWNER_REVIEW_ORIGIN, OWNER_REVIEW_PORT,
  OWNER_REVIEW_CLOUD_ORIGIN
- OWNER_REVIEW_IDENTITY_DB_URL, OWNER_REVIEW_REGISTRATION_DB_URL,
  OWNER_REVIEW_ISSUER_DB_URL (three independent restricted SQL logins)
- OWNER_REVIEW_OWNER_SUB, OWNER_REVIEW_BETTER_AUTH_SECRET,
  OWNER_REVIEW_GITHUB_CLIENT_ID, OWNER_REVIEW_GITHUB_CLIENT_SECRET,
  OWNER_REVIEW_CSRF_KEY
- OWNER_REVIEW_TLS_KEY_FILE, OWNER_REVIEW_TLS_CERT_FILE,
  OWNER_REVIEW_CLOUD_PUBLIC_KEY_FILE (Cloud Ed25519 PUBLIC key only)

The launcher requires exact HTTPS origins, binds to loopback, and compares
physical PostgreSQL principals and underlying table identities. Startup
is denied if issuer, identity and registration SQL accounts are not
distinct, or if the issuer can activate passkeys, modify receipt scope,
consume approvals or delete credentials. The registration account must
also pass its existing least-privilege preflight.

A signed Cloud request can be reviewed only if the separate issuer finds
EXACTLY ONE already enabled passkey owned by the independent human identity.
Zero or multiple enabled credentials fail closed. Neither an OAuth client
nor a Cloud request may supply the credential ID. A real Better Auth owner
session, CSRF and UV WebAuthn proof remain mandatory before receipt issuance.
No activation, MCP token issuer, connector WSS or local KiCad read is mounted.
Shutdown closes all independent SQL pools; no errors print secrets.

The disposable PostgreSQL/HTTPS acceptance tests validate denied-by-default
startup, separate SQL principals, excessive-privilege rejection, failure
without active credentials, actual signed-intent delivery with a synthetic
active credential, and replay rejection. Those credentials and SQL grants
exist ONLY inside the isolated test. Deployment, key provisioning, physical
owner authentication and KiCad device acceptance remain blocked.
