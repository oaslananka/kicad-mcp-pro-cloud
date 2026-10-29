# Outbound WebSocket bootstrap — code implemented, production disabled

Status: **feature gated OFF**, no production acceptance, and **no KiCad
operations**, command relay, file contents, or MCP tool messages travel over
this socket. This is not an operationally authorized connector deployment.

The local agent would initiate an outbound **WSS** connection to
`/api/v1/connector/ws` through the configured, trusted TLS ingress. The
Cloud listener is plain HTTP behind that ingress. Do not activate this
feature until Cloudflare/ingress upgrade routing, end-to-end TLS, device
authentication, owner authorization, rate limits and physical local-client
interoperability have been verified.

Enablement requires the explicit server-side
`CONNECTOR_WS_ENABLED=true` environment flag **and**
`PUBLIC_ORIGIN=https://...`. The normal production default is disabled
and no new path becomes available merely by merging this PR. Never add
secrets to GitHub Actions beyond the repository's existing Doppler token.

## Exact, strict v1 wire flow

All messages are small (< 1024-byte) UTF-8 text JSON frames. No compression,
binary frames, cookies, browser Origin, bearer token or subprotocol is
accepted. The Upgrade request must use the exact path, with no query string.
Headers identifying an owner or device are never trusted.

1. After WebSocket upgrade, the untrusted device sends
   `{"kind":"device.hello","version":1,"ownerSub":"...","deviceId":"..."}`.
   These are claims, not authentication. Issuance uses the existing enabled
   device and unrevoked public key, at most one pending DB nonce, and local
   per-source/per-device rate limits.
2. The server sends `device.challenge` with a random 256-bit nonce and
   challenge ID. It retains only the nonce's SHA-256 in PostgreSQL.
3. The device sends `device.proof` with a canonical base64url Ed25519
   signature of `deviceHandshakeProof(challengeId,deviceId,nonce)`.
   PostgreSQL atomically checks its enrolled key and consumes the nonce.
   No `ownerSub` or `deviceId` is considered authenticated until this
   check succeeds.
4. The server then calls `BoundConnectorConnections.begin()` with the
   **actual WebSocket object** as key, and sends a separate
   `connector.session_challenge`. The device signs the existing
   domain-separated `connectorSessionProof`, returning the signature
   as `connector.session_proof`.
5. Only after that second signature and DB session transition succeed does
   the server send `connector.ready`. The session has a bounded five-minute
   lifetime; WebSocket ping/pong provides only transport liveness.

Unexpected messages, extra attributes, oversized/binary frames or failed
signatures are denied and close the socket. There is **no inbound command
handler** after ready, so a sender cannot reach the KiCad engine. Closing
the transport cancels a pending bootstrap nonce and closes an already
issued database-backed connector session.

Per-process controls: 96 concurrent open sockets, six sockets per network
source, twelve upgrades per minute per source, five bootstrap challenges
per minute per claimed device, a fifteen-second initial timeout, a
sixty-second signature timeout and a five-minute session cap. These counters
are intentionally **not** asserted to provide distributed DDoS prevention:
production enablement needs an ingress rate limiter and an atomic
database-backed per-device issuance budget across all app replicas.

## Strict expiry after asynchronous read authorization

The optional server-to-device `project_summary` relay issues a single
`connector.authorized_read` with a short, absolute signed request deadline.
The database-backed signed-read admission gate also accepts only project_summary.
It rejects signed run_drc and run_erc requests even after the owner, OAuth
client, session, device and project grant are valid. These operations remain
generic protocol vocabulary, not Cloud authorization for this connector release.
Invalid operations do not advance the one-shot sequence; a legitimate summary
can still be accepted.
When the local device replies, the Cloud transport checks the exact
request/project identity and deadline, then asynchronously revalidates the
owner/OAuth-client project grant and active device binding in PostgreSQL.

**Wall-clock rollback resistance:** Unix milliseconds remain the wire
request deadline and are still checked. The server independently tracks the
same read window and five-minute session cap with the process monotonic
clock, including rechecking after async grant authorization. Per-process
rate buckets also use elapsed monotonic time, so an OS wall-clock change
cannot reset the window early. The PostgreSQL-backed WebSocket regression
first reproduced the bug: after eight seconds of real elapsed time, setting
the host wall clock back 30 seconds made the old code return project-presence
metadata. The corrected implementation returns no result or ACK and closes
with policy 1008. Clock manipulation in this fixture is limited to the
disposable test process, not the machine clock. This does not provide a
distributed ingress rate limiter, independent owner approval, or real-user
OAuth acceptance.

**A passing database query is not an extension of the original deadline.**
If the query finishes after the original request deadline or after the
bounded device session expires, the server discards the result, closes
the WebSocket with policy code 1008, and sends **no**
`connector.read_ack` or HTTP data. Both deadlines are rechecked
**after** the awaited authorization and before the ACK. The HTTP handler
independently rechecks JWT expiry, token cutoff and the current
project/device grant before sending an HTTP result.

**HTTP final grant-lookup expiry:** The HTTP endpoint verifies the OAuth
JWT after the one-shot WebSocket relay returns, then awaits token-cutoff
and project/device grant checks. The **last** project grant lookup can
itself outlive the token expiry, making the earlier re-verification
stale. Before releasing project-presence metadata, HTTP now performs a
final JWT verification **after** that awaited project lookup. A
RED-before-GREEN localhost HTTP regression uses a verifier that becomes
invalid while `getProject` is awaited; the old response was HTTP 200
with metadata, the corrected response is 403 with no presence fields.
This final check narrows the read-to-response race but does not claim
atomicity across HTTP serialization, PostgreSQL and external revocation.


**Token cutoff revocation during that same lookup:** A token need not
expire to lose authorization. A client-token cutoff may be committed while
the final asynchronous project lookup is in progress, after the previous
cutoff check. Cloud now queries `isAccessTokenAllowed` once more after
that final project lookup and JWT verification, before writing presence
metadata. The localhost HTTP regression demonstrates that a token revoked
during `getProject` previously received HTTP 200 and now receives 403.
This is a final checked authorization boundary, not an atomic revocation
barrier across a future network write.

The regression `test/connector-deadline-after-authorization.test.ts`
simulates a previously authorized, real localhost WebSocket read whose
database grant check completes after the signed deadline: it must return
`null`, emit no ACK and close with 1008. The full disposable PostgreSQL
17 suite also verifies the normal one-shot result/ACK and in-flight
grant, token and device revocation; test actors and keys are synthetic.
This does **not** establish production ingress, real user OAuth, or
independent local operator approval.


**Initial authorization also has a finite budget:** A signed
`connector.authorized_read` is not constructed until the initial
owner/client/project grant preflight returns. This first DB check
previously had **no request watchdog** at all; a stalled query could
leave an HTTP read waiting indefinitely with no remote frame sent.
The Cloud relay now limits initial preflight waiting to eight seconds,
rejects the socket on timeout, and refuses to send if less than ten
seconds remain in the device session after the check. A delayed DB
response cannot restart or renew a rejected read. The isolated localhost
WebSocket regression uses a test-accelerated timer to prove that a
stuck first check resolves the HTTP promise with `null`, sends no
`connector.authorized_read` and closes with policy code 1008.
The first preflight also races the authenticated WebSocket's
`close` event: if the physical device disconnects while the initial
database authorization is in progress, the HTTP relay promise resolves
with `null` immediately instead of waiting for the full eight-second
preflight timeout. The disconnect listener is removed as soon as
preflight completes. A RED-before-GREEN localhost WebSocket regression
proves no read frame or metadata is delivered and that the read wait
ends on device disconnect; the existing four expiry, final-validation,
and timeout cases remain green.

The separate twelve-second post-dispatch watchdog still applies to
the subsequent one-shot read and final revalidation. Real DB queries
may continue server-side after their caller times out; database-level
query timeouts remain an independent operational control.

**Database authorization failure is a denial, not a live socket:**
The initial `authorizeOutgoingSummary` may **reject** because of
a transient PostgreSQL error, in addition to returning false or
timing out. Previously that exception escaped `requestSummary`
and could strand a ready but single-use-reserved device session.
The initial grant now catches the rejection, returns `null` and
closes the authenticated socket with policy 1008 **without issuing
`connector.authorized_read`**. An isolated real localhost WS
RED-before-GREEN regression verifies the no-read, no-HTTP-result
behavior. A separate regression verifies that a rejected **final**
grant also settles the HTTP promise with `null`, closes the socket
and sends no `connector.read_ack` or project-presence metadata.
Neither test requires a real OAuth user or production database;
full synthetic DB acceptance is still required before release.

**Stalled final database check and socket disconnect:** The 12-second
request watchdog must remain armed while the final asynchronous grant
revalidation is pending; clearing it at receipt of the local result would
leave the HTTP relay promise waiting indefinitely on a stuck database
query. A distinct per-socket in-flight validation reference lets the
timeout, WebSocket disconnect and policy-close cleanup settle that
promise with `null` immediately, without acknowledging or releasing
the cached metadata. `test/connector-deadline-after-authorization.test.ts`
also exercises a stalled validation under a test-only accelerated
watchdog and device disconnect before validation finishes, alongside
the expired-deadline scenario. This is bounded cancellation, **not**
a guarantee that a backend DB query itself gets cancelled; production
query timeouts still require independent database configuration.

## Independent owner consent: read dispatch now defaults to deny

A device's two valid Ed25519 transport proofs and a valid OAuth client/project
`readonly` grant do **not** prove an independent human approved a local read.
The Cloud relay's `requestSummary` now fails closed when no
`OwnerReadConsentPort` is configured. `src/main.ts` deliberately does not
configure that port, so turning on the dormant WebSocket feature flag alone
**cannot dispatch any `connector.authorized_read` frame**.

The port is a server-owned contract to **atomically verify and consume** a
future independently owner-authenticated, one-shot authorization. It receives
the verified OAuth identity, exact device/project, a newly generated request
UUID, the sole allowed `project_summary` operation, and an absolute expiry.
The same UUID goes into the WebSocket read, and its deadline is capped by
both the accepted owner window and the eight-second read budget. A rejected,
unavailable or stalled verifier denies before database grant/dispatch; the
stall has an independent eight-second watchdog and a closed device socket
releases the wait. A consumed owner decision cannot be retried on the same
session; metadata also stays subject to the existing post-read OAuth and grant
checks. The connector is deliberately one-shot.

**One-use receipt persistence is now implemented but NOT connected:**
`db/013_owner_read_approvals.pgsql` and
`src/owner-read-approval-ledger.ts` persist only an exact owner/client,
device/project/origin, `project_summary`, request UUID and expiry. The consumer
uses one PostgreSQL atomic conditional update and denies missing, mismatched,
expired, raced or reused receipts. It has **no receipt issuance API, owner
signature verifier, browser route, user-verification credentials, or configured
production binding**. Only a separately trusted owner authority may be allowed
to insert records in a future integration. Current production Cloud does not
instantiate this ledger or wire it to the WebSocket; adding a database table
alone does not authorize any read. A synthetic isolated PostgreSQL test seeds
rows directly, verifies 12-way racing consumes exactly once, and proves field
mismatch and expiry denial. The future owner authority must authenticate user
presence and protect the database's issuance privilege independently; a
same-UID agent with database write access is NOT trusted.

**Approval receipt database privilege separation (Cloud draft only):**
`PgOwnerReadApprovalLedger.consume` now also refuses to consume a receipt when
its active PostgreSQL identity can insert/delete/truncate approvals or update
any approval identity, scope or expiry field. This includes a table owner or
superuser, even if an otherwise correctly bound row exists. A future consumer
credential must be a distinct, non-owner PostgreSQL role with schema USAGE,
table SELECT and column-specific UPDATE on `consumed_at` only; it must not
inherit issuance privileges or have elevated role administration rights.
The independent, genuinely human-authenticated issuer must use a different
isolated principal, and must have its own reviewed write restrictions.

The synthetic PostgreSQL regression provisions a disposable distinct role,
verifies INSERT, DELETE, TRUNCATE and identity-field UPDATE are denied by SQL,
shows table-owner consumption fails closed, and proves legitimate one-time
consumption and concurrent replay denial still work. **No production roles,
grants, credentials, migrations or runtime wiring were created or changed.**
The future privilege provisioning and actual human-presence authenticator
remain unimplemented release blockers; the Cloud socket continues to reject
reads without an independently authorized issuer.

**One-time means immutable at the database level:** migration
`014_owner_read_approval_replay_guard.pgsql` adds a PostgreSQL
`BEFORE UPDATE OF consumed_at` trigger. Once a receipt is consumed, even a
consumer with the narrowly granted `UPDATE(consumed_at)` privilege cannot
reset it to NULL or move its timestamp and reuse the receipt. Invalid
consumption timestamps also fail closed. This is an append-only migration:
previous `013_owner_read_approvals.pgsql` bytes/checksum remain unchanged.
The disposable PostgreSQL role test demonstrates the replay defect against
migration 013 alone (RED) and verifies SQL-level replay/reset rejection after
014 (GREEN). This is not an independently authenticated approval issuer.



**No real owner verification port, public enrollment, credential or user
presence authenticator has been implemented.** Only synthetic test fixtures
inject a port that returns true to exercise the existing transport/grant
behavior. Their success must never be labeled real owner approval; a
production port must be backed by a separately verified authenticator and
atomic replay-proof persistence, not a PTY or device signing key.
The partner local repository's
[owner consent boundary design](https://github.com/oaslananka/kicad-mcp-pro/blob/69342ceb90b83a471111286933f9a2e86e67de2f/docs/cloud/OWNER-CONSENT-BOUNDARY-ACCEPTANCE.md)
defines the outstanding independent-principal and human-authentication tests.

Red/green integration evidence: before this guard, a real temporary signed
WebSocket session proceeded without any owner verifier. After the guard,
`test/connector-deadline-after-authorization.test.ts` confirms no frame and no
DB grant preflight without an owner port, plus rejection/timeout denial,
exact UUID binding, one-shot positive synthetic handling, expired deadlines,
revocation, stalled DB and device-disconnect behavior. Full `npm run check`
passed with **135/135 tests**, none skipped, against a fresh temporary,
isolated PostgreSQL 17 container; no production Cloud credentials/data,
deployment or host-service changes.

## Not yet authorized or integrated

- Native local desktop connector enrollment, secure Ed25519 private-key
  storage, outbound TLS certificate validation and reconnect UX.
- Trusted reverse-proxy origin, request upgrade path, forwarded IP and
  WebSocket routing verification; connection security at the real ingress.
- Actual browser user/owner session, Google/GitHub login and real host OAuth.
- Persistent cross-worker rate limiting, distributed DoS controls, heartbeat
  failover, reconnect and cancellation/expiry semantics.
- OAuth-client/project capability dispatch, Cloud/local policy intersection,
  local read-only KiCad engine acceptance, physical DRC/ERC execution.
- No local file/path storage in Cloud, no raw 387-tool forwarding, and no
  unattended write access. User approval is still required for any writes.

Disposable PostgreSQL/WebSocket tests exercise the authentic two-key-proof
handshake and denial of unauthorized messages; they do **not** constitute
production or real KiCad acceptance. No new migration or cloud infrastructure
resource is introduced.


The WebSocket upgrade now also requires a verified ingress TCP peer and
single `CF-Connecting-IP` header; both use the same fail-closed source
resolver as device enrollment. See
[trusted ingress source](TRUSTED-INGRESS-SOURCE.md).

## Standalone WebAuthn owner approval issuer — library core only, not deployed

Draft-only `src/owner-read-webauthn-issuer.ts` and migration
`015_owner_read_webauthn_issuer.pgsql` implement the **server-side**
signature-verification and restricted-receipt-issuance primitive using
`@simplewebauthn/server`. The issuer requires an already registered,
explicitly enabled owner passkey, a fresh cryptographic challenge, the exact
HTTPS origin/RP ID, a verified signature, and **user verification required**
(verified UV bit; PIN/biometric passkey verification). A request can only
issue one `project_summary` receipt bound to its persisted owner, OAuth
client, local device, project, origin, request UUID and <=30-second expiry.
An attempted assertion is consumed atomically before cryptographic checking,
including when the signature, origin, RP ID, counter, UV bit or credential is
invalid. A revoked passkey or old positive signature counter cannot issue a
new approval. The issuer uses only an INSERT-scoped approval-writer login,
and the earlier consumer rejects that identity.

The test `test/owner-read-webauthn-issuer.test.ts` exercises actual P-256
WebAuthn signatures, a separate PostgreSQL issuer role, and denial of
missing UV, invalid origin/RP ID, forged signatures, counter replay, a
reused/failed challenge, revoked passkeys and mismatched owners. Test keys,
passkey credentials and PostgreSQL logins are entirely synthetic.

**This is not a finished human approval product.** There is deliberately
NO HTTP issuer, no browser passkey enrollment or registration workflow, no
authenticated owner session for the issuer, no user-visible display of the
exact read scope, no independently deployed issuer, no issued production
passkey, no provisioned writer/consumer SQL accounts, and no Cloud
`ownerConsent` runtime wiring. The current socket's eight-second consent
budget is insufficient to assume reliable interactive passkey verification;
a future end-to-end design must explicitly reconcile the pending read,
user-presence UX, request/session deadlines and authentication trust
boundary, then test real hardware. A normal OAuth login does NOT establish
passkey UV for each request. Merely merging this code or changing a feature
flag must never authorize a device read.

## Owner review interface (isolated Cloud draft, not enabled)

`src/owner-read-approval-ui.ts` and `src/owner-read-review-client.js`
provide a review page and **explicit** WebAuthn click flow for a separately
authenticated issuer service. The page displays the server-verified owner,
OAuth client, device UUID, project UUID, one permitted `project_summary`
operation, Cloud source origin and 30-second expiry. It uses escaped text,
no-store/no-referrer, frame rejection, and a same-origin external JavaScript
with no silent invocation. Approve calls browser
`navigator.credentials.get({publicKey:{...,userVerification:'required'}})`
only after a direct click; Deny makes no approval request. The server must
still verify the passkey UV bit and authentic signature, owner identity,
intent, one-time challenge and current grant: display content alone is
**not** authorization.

The **approval authority HTTPS origin** is distinct from the **Cloud data
source origin**: WebAuthn RP ID and signature origin must match the
independent approval authority's configured origin, not a target Cloud
host claimed by the OAuth client. A real deployment therefore needs a
separate and browser-reachable issuer with its own owner authentication,
passkey registration and privilege-isolated SQL writer. Neither the Cloud
application nor a caller-supplied origin can substitute for it.

`test/owner-read-approval-ui.test.ts` tests HTML escaping, scope mismatch,
missing user verification and expiry, plus headless Chromium **virtual
authenticator** registration and a real signed authentication assertion
verified by SimpleWebAuthn on an isolated, self-signed local HTTPS
test server. This browser test proves no silent approval, an actual
explicit-click signed approval and the deny path. It does not constitute
a real enrolled human/passkey device test and the test HTTPS server is
not the production issuer.

**No HTTP handler or approval endpoint has been installed**, and no
issuer login, passkey credential or production database permissions have
been provisioned. Before wiring this into any public service, independently
review the authorization of begin() and approve(), CSRF/Origin/Fetch
Metadata, renewal and request timeout/revocation race, user-verification
credential enrollment and issuer deployment trust. The current Cloud
connector's eight-second consent wait is not adequate evidence of a
human-completable WebAuthn ceremony. Remain DRAFT and feature OFF.

## Passkey registration (draft-only, separate trust boundary)

The independent owner-approval authority now has registration primitives
`src/owner-read-passkey-registration.ts`, `src/owner-read-registration-http.ts`
and append-only migration `016_owner_read_passkey_registration.pgsql`.
No production HTTP route, issuer process or credential has been installed.

The registration core generates one-time ES256 WebAuthn creation challenges
with `userVerification: required`, checks the passkey's cryptographic
attestation, HTTPS authority RP ID and origin, owner-bound challenge,
120-second expiry and one-use consumption. A failed proof also burns the
challenge. Challenge reuse, expiry, replay and incorrect origin fail closed.
A successful registration creates a credential with `enabled=false` and
**never** authorizes a project read. A separate, strongly authenticated
owner/security authority must explicitly activate it after enrollment.

The HTTP adapter is **not** mounted by the Cloud app. A future independent
issuer must supply a trusted owner-session verifier returning owner subject
and server-side session CSRF token. It rejects missing user sessions, wrong
Origin/Fetch Metadata, CSRF mismatches, oversize JSON, non-POST requests
and caller-controlled owner identity or request UUID. The adapter never
accepts owner subjects from browser-submitted JSON. Deployment still
requires a real independently authenticated owner-session implementation,
session lifecycle, CSRF secret provisioning and rate budget.

The registration database role is separate from both the approval issuer
and read consumer: its restricted credentials may save an unactivated
credential but cannot write `enabled=true` or issue an approval receipt.
Tests use disposable PostgreSQL 17 roles and actual Chromium virtual
WebAuthn registration, prove that browser-generated ES256 credentials
remain inactive and no approval is issued, and reject forged client data,
cross-owner completion, reused challenges, expired challenges and direct
reset of used challenge state. The HTTP contract tests use a **synthetic**
authenticated-session callback solely for local testing; they do not
establish real human identity or production access.

**NO-GO remains in force:** Real owner enrollment, separate identity service
and owner activation ceremony, deployable issuer, physical KiCad acceptance,
signed browser session verification and end-to-end production WSS remain
unproven. Keep `CONNECTOR_WS_ENABLED` disabled and PR #64 DRAFT.

## Independent owner passkey enrollment page (draft-only)

`src/owner-read-enrollment-ui.ts` and
`src/owner-read-enrollment-client.js` add a small registration UI and
same-origin browser workflow, deliberately **not** installed in the
production Cloud router. The standalone HTTPS page handler requires an
independently authenticated owner session and exact authority Host plus
same-origin or top-level navigation Fetch Metadata. The HTML escapes
the owner label, preserves a session-bound CSRF value inside a non-executable
JSON script tag, disables framing, and uses no-store/no-referrer and a
same-origin external JavaScript file.

The UI does not automatically start a challenge when loaded. Only clicking
**Register passkey** calls the already restricted `/owner-passkey/register/begin`
endpoint, converts the verified HTTPS RP-ID-bound ES256 challenge into
the browser's `navigator.credentials.create()` ceremony, and submits
the signed credential response to `/owner-passkey/register/complete`.
The server must still verify user presence and user verification. A
successful enrollment displays **registered but not activated**; the UI
provides no activation, issuer-approval or KiCad remote-read button.

`test/owner-read-enrollment-ui.test.ts` exercises HTTPS session rejection,
the no-silent-registration condition, actual Chrome virtual WebAuthn
creation and server cryptographic verification after a user-interface
click. The browser test's owner-session callback and registration result
are explicitly **synthetic**; the separate PostgreSQL test verifies
registration creates a disabled credential with a limited DB role.
Neither acceptance test proves enrollment or identity verification of a
real owner or a physical passkey. A real independent owner-authenticated
issuer deployment, separate passkey activation ceremony and physical
KiCad E2E remain blocking; keep PR #64 DRAFT and production connector OFF.

### Failed attestation challenge consumption (RED/GREEN regression)

The browser-generated, correctly challenged ES256 registration proof was
corrupted at its WebAuthn attestation byte payload. In the earlier draft,
the verification library threw and the broad SQL rollback restored the
previously claimed registration challenge. The **same original valid
registration could then be submitted and accepted**, contrary to the
documented single-use guarantee.

A PostgreSQL 17 test reproduces that exact RED behavior first, then proves
the corrected behavior: exceptions during cryptographic verification
commit the claim (burning the challenge) and the original valid proof
subsequently receives `denied`; the consumed timestamp persists.
Persistence/credential-storage errors still roll back their transaction,
so no partial passkey is inserted. This change is only on PR #64's
disabled draft path, not in production.
