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

### Issuer challenge replay guard — append-only migration 017

A separate PostgreSQL 17 negative test reproduced another one-use violation:
the restricted issuer role is granted only `UPDATE(used_at)` on
`owner_read_webauthn_challenges`. Before migration 017 it could set
a rejected WebAuthn approval challenge's `used_at` back to NULL; this
rearmed an already attempted proof. The older registration challenge
table already had a comparable one-use trigger, but issuer challenges
did not. A credential counter alone does not substitute for this fence
(e.g. valid platform passkeys may have a zero counter).

Append-only `017_owner_read_webauthn_challenge_one_use.pgsql` now
installs a `BEFORE UPDATE OF used_at` trigger. It rejects any further
update after consumption and invalid initial consumption timestamps,
including NULL, timestamps before issue and at/after expiry. The
limited-privilege issuer can still make its **first** atomic claim, but
cannot reset or replay it even after a rejected assertion. The
isolated test is RED against the pre-017 schema and GREEN with 017.
All historic migrations, including 013–016, retain their original
bytes and checksums. No production credential, socket or issuer is
enabled by this draft-only schema.

## Owner passkey activation (independent, NOT production-enabled)

`db/018_owner_read_passkey_activation.pgsql` and
`src/owner-read-passkey-activation.ts` provide a standalone
registration-to-active boundary. The activation requires a **new**
WebAuthn authentication challenge (120-second expiry, single attempt,
userVerification required) tied to an *existing but inactive* credential
and a trusted owner identity supplied by an independently authenticated
owner session. The server verifies the P-256 signature, expected issuer
HTTPS origin/RP ID, stored public key, authenticator counter and UV bit
before changing `enabled` to true. A database trigger makes activation
challenges irrevocably consumed: the activation SQL login cannot reset
`used_at` to permit replay. Failed proofs permanently consume their
challenge and require a newly authenticated request.

The restricted activation SQL login needs only table SELECT on passkeys,
UPDATE on `enabled` and `sign_count`, and a separate activation challenge
ledger. It must NOT be the registration role, issuer role, approval receipt
consumer or an application table owner. It is unable to modify passkey
public keys, insert a passkey, or create a project-read receipt.
`test/owner-read-passkey-activation.test.ts` uses isolated PostgreSQL 17
role credentials and real synthetic P-256 signed WebAuthn assertions to
validate successful one-time owner activation, missing UV, wrong origin,
forged signatures, wrong owner, direct replay/reset, database role limits,
and **zero owner-read receipts** after activation.

**Security limitation:** a compromised activation SQL principal with
`UPDATE(enabled)` could bypass the TypeScript proof checks. This is
an independently privileged operator capability, NOT proof of a secure
production activation service. The real activation endpoint must be
isolated from Cloud and the OAuth client, strongly authenticated with a
real owner session, protected from direct SQL/endpoint misuse, restricted
by independent ingress/CSRF/rate controls and accepted using a physically
enrolled real passkey. No activation HTTP handler, owner login verifier,
production SQL role, passkey enrollment, credential, or feature flag
is deployed. PR #64 remains DRAFT and Cloud connector OFF.

### Full synthetic passkey ceremony acceptance (separate DB principals)

`test/owner-read-complete-ceremony.test.ts` is a single local,
**not-production**, cross-component acceptance scenario. An isolated HTTPS
browser with a Chrome virtual authenticator creates an actual P-256/WebAuthn
credential, registers it as inactive, proves that inactive enrollment cannot
issue a consent receipt, activates it with a new user-verified signature,
signs a separate owner-read challenge, inserts exactly one metadata-only
`project_summary` receipt and consumes that scope exactly once. This
scenario checks wrong OAuth client, wrong project, activation challenge
replay, issuance challenge replay, receipt replay, and role separation.
It uses **four distinct PostgreSQL NOLOGIN roles** with precisely granted
registration, activation, issuer, and read-consumer privileges. Role
switches occur only in isolated test database sessions; no test role
credentials are stored or applied to a live database.

This is a **synthetic integrated ceremony**, not an actual human owner
login or a deployed issuer. The test supplies the trusted owner identity
and scope itself, so it does NOT establish that a real OAuth client,
real physical owner, local operator boundary or WebSocket request
created that scope. The production Cloud router does not mount any of
these standalone classes. PR #64 MUST remain DRAFT and the connector
MUST remain OFF pending actual independently authenticated owner
session, real passkey and physical KiCad end-to-end acceptance.

### Independent owner session backed by real Better Auth validation

`src/owner-read-better-auth-session.ts` supplies an opt-in, standalone
`RegistrationSessionVerifier` for the independent HTTPS owner approval
authority. It uses the issuer's own `betterAuth.api.getSession` with a
signed browser cookie and current PostgreSQL session rather than a
request-submitted user ID, OAuth-client claim, or synthetic trusted callback.
The factory **requires the Better Auth instance's exact HTTPS baseURL to
equal the independent authority origin**, a configured exact owner ID and
an independent random CSRF key. It rejects wrong Host, proxy-forwarded
authority overrides, Bearer headers, malformed cookies, expired sessions,
unverified owner emails and sessions for a different owner. An HMAC-derived
CSRF token is scoped to the actual authenticated session ID, session token,
allowed owner ID and authority origin. Session revocation makes both cookie
and CSRF token unusable on subsequent requests.

`test/owner-read-better-auth-session.test.ts` uses Better Auth 1.7.13's
**real signed HTTPS session cookie** and a disposable PostgreSQL user and
session table. It proves expired, unverified, forged, non-owner and revoked
sessions are rejected, and a new session generates a different CSRF token.
`test/owner-read-better-auth-session-http.test.ts` uses a local,
certificate-validated HTTPS listener to exercise the **existing registration
page and registration HTTP adapter** using that real Better Auth owner
verifier. Anonymous, unsigned, forged-host, cross-site and CSRF-invalid
requests fail; a valid current owner session can start the registration
challenge, and after session revocation its old cookie/CSRF cannot do so.

**Critical deployment boundary:** the independent issuer MUST authenticate
its own first-party Better Auth session under its own HTTPS origin, OAuth
redirect registration, identity-store/secret and ingress. NEVER forward
Cloud's first-party browser cookie to a different authority host or share
a production database/Better Auth signing secret to fake this boundary.
No issuer is deployed or mounted on Cloud; the tests use synthetic Better
Auth users inserted into disposable PostgreSQL, NOT a real human's OAuth
sign-in, physical passkey, public owner issuer, or local KiCad acceptance.
The independent owner ID/key/provider setup and enrollment remain
release-blocking; PR #64 stays DRAFT and `remoteConnector` stays OFF.

### Prepared owner consent before local read (draft-only API)

A real owner cannot reliably review and sign a passkey confirmation inside
the local read's existing **8-second** consent-consumption budget. The
connector now exposes a server-side `prepareOwnerSummary` step returning
one immutable, randomly assigned `requestId` and exact owner, OAuth
client, device, project, origin, `project_summary`, and 30-second expiry.
It is scoped to the currently authenticated ready socket. Nothing is
sent to the device at preparation time.

A subsequent `requestSummary(oauth,deviceId,projectId,prepared)` **requires**
that exact previously prepared intent. **No prepared argument always means
denial**, even when no other preparation is pending; the former direct
consent/dispatch shortcut is removed. The prepared intent must be the
**same in-memory object**, still under the same authenticated
socket and exact owner/client/project/device; it burns the preparation on
attempt. Cloning or modifying its JSON, replaying its reference, swapping
OAuth clients, disconnecting the device, or calling the legacy direct
dispatch while an intent is pending cannot authorize that reservation.
Even the original intent is **not sufficient to read**: the independently
authenticated owner authority must create the exact one-time PostgreSQL
approval receipt, which the connector consumes before the existing
short-lived device read (8-second wire deadline and revocation recheck).

The existing short local read/DB deadlines are unchanged. This separates
human review preparation from device dispatch, **but is NOT production
authorization**. The existing HTTP `project-summary` entrypoint does not
yet construct or provide a prepared intent and therefore fails closed even
if a synthetic consent port were supplied. Any future HTTP approval flow
needs a separately authenticated preparation and completion design, not
a fallback to the old immediate read. It is only a local connector API without a public
trusted OAuth request-preparation route, deployed owner issuer, real
physical passkey, or verified operator. The existing issuer still requires
confirmation inside its 30-second expiry; human usability of that window
must be accepted with a real device. No production `ownerConsent` port
is wired and the connector remains OFF.

### Two-step OAuth HTTP bridge (draft-only, fail closed)

The Cloud HTTP router now supports exactly two bearer-authenticated endpoints
**only when the disabled-by-default connector relay is explicitly supplied**:

1. `POST /api/v1/connector/project-summary/prepare` — strict JSON
   `{deviceId,projectId}`. A verified `projects:read` OAuth access token,
   token cutoff and current owner/client project-device binding are checked
   before the server asks a ready connector to reserve a one-use owner intent.
   The server returns the bounded request ID plus exact displayed owner,
   OAuth client, device, project, origin, operation and expiry. No device
   read is dispatched and **no owner approval is created** at this stage.
2. `POST /api/v1/connector/project-summary` — strict JSON
   `{deviceId,projectId,requestId}`. The server looks up the **original
   opaque intent object retained only in memory**, tied to the *same
   OAuth bearer token* (SHA-256 digest only in memory), owner, client, token
   issue time, device and project. It atomically burns the mapping before
   dispatch. Only then can `requestSummary(...,prepared)` independently
   consume the exact WebAuthn owner-approved PostgreSQL one-shot receipt.
   Existing JWT expiry, token cutoff, device grant, and post-read checks
   still run before any metadata bytes leave Cloud.

The old two-field direct HTTP read body now returns HTTP 400. A stolen,
copied or guessed request ID **alone** cannot authorize a read; a different
signed token for the same owner/client also cannot spend it. A mismatched
attempt with the same request ID burns that mapping; concurrent completions
cannot both dispatch. Pending references are monotonic-time bounded to at
most 30 seconds and capped at 128 per HTTP server process. An HTTP restart
drops all pending references, so an old request **must never be resumed**
through a new instance. This is intentionally an in-memory, single-instance
draft; multi-instance distribution is not supported.

HTTP tests verify token substitution, OAuth client swapping, altered
project/device scope, replay, parallel completion and post-read revocation.
A passing HTTP test with a synthetic relay is **not a substitute for a
real human passkey approval receipt**. No public independent owner review
service or real OAuth client/passkey is deployed, and `main.ts` does not
supply an owner consent verifier; live `remoteConnector` remains OFF.

### Optional read-only receipt consumer role (draft-only wiring)

The Cloud entry point now recognizes an **independent and default-OFF**
`OWNER_READ_CONSUMER_ENABLED=true` configuration together with
`OWNER_READ_CONSUMER_DATABASE_URL`. The second URL is a dedicated PostgreSQL
login; it must be provisioned through an approved private secret manager and
must **never** reuse the application database's login. This flag alone does
not turn on the connector: `CONNECTOR_WS_ENABLED=true` and an exact HTTPS
Cloud origin are separately required.

At startup, the Cloud process checks both SQL sessions, resolves the same
`owner_read_approvals` relation, requires physically different PostgreSQL
session principals, and fails closed unless the consumer can SELECT receipts
and UPDATE only their `consumed_at` column. An account able to INSERT,
DELETE, TRUNCATE, update the table generally, or rewrite the receipt identity,
scope or expiry is rejected. The consumer module has no approval issuance
method, does not register/activate a passkey and cannot authenticate a human.
It opens a separate small connection pool, closed with the Cloud process.
Malformed flags, missing secrets and unsafe roles fail before the HTTP
listener starts; the independent login is never printed.

Isolated PostgreSQL tests exercise the actual restricted login and receipt
consumption, concurrent reads, replay rejection, default OFF, application
login reuse and malicious overprivileged roles. The independent human
WebAuthn issuer and device operator are **still not deployed or accepted**.
These configuration keys are preparation artifacts, not authorization to
enable a live connector or release this DRAFT PR. The production release
gate stays **NO-GO** until real human owner identity, physical passkey,
independent consent issuance and KiCad device end-to-end acceptance pass.

### Approval issuance remains independently isolated

`src/owner-read-review-http.ts` can issue a WebAuthn-backed approval
receipt **only from a server-injected trusted intent** and a separate
authenticated owner session. The HTTP bearer client is never trusted to
supply that intent to the issuer, and no public enrollment or review
endpoint is connected to the Cloud connector process. This code is
deliberately **unmounted**, unlike the Cloud's owner-consent *consumer*.
Before physical acceptance, a separately authenticated service-to-service
intent transport must prove that the request matches Cloud's live
prepared owner/OAuth/client/device/project binding; exposing a public
`addTrustedIntent` endpoint or accepting a client's copied JSON scope
would break the security boundary and is prohibited.

### Signed Cloud-to-independent-owner intent exchange (DRAFT; no deployment)

`src/owner-read-intent-transfer.ts` provides a separate-service HTTPS
intent delivery contract. Cloud, **after** validating the user's
`projects:read` OAuth token, device/project binding and live socket,
signs the server-generated `PreparedOwnerSummary` with its own
**Ed25519 private key**. The only accepted signature domain is
`kicad-owner-read-intent-v1`, covering exactly the owner, OAuth client,
device, project, Cloud HTTPS origin, `project_summary`, request UUID and
30-second expiry. The request is sent by Cloud itself using normal TLS
verification to one explicitly configured HTTPS owner-authority origin at
`POST /internal/owner-read/intent`; redirects and unsigned responses are
never followed. OAuth bearer tokens, Cloud database connections and signing
private keys are **not** sent to the owner authority.

The independent authority's separate receiver requires the pinned **Cloud
Ed25519 PUBLIC key**, exact Cloud HTTPS origin, valid bounded signature and
scope, and a fresh one-time request ID. It independently resolves a currently
enabled owner passkey credential using its own trusted credential selector,
then calls the existing `addTrustedIntent` server-side method. Invalid,
duplicate, expired, tampered, oversized, forwarded-host, bearer-cookie or
unrecognized requests are denied before challenge creation; authenticated
intake is at most 128 pending entries. The browser/OAuth client has NO
endpoint to register a scope or select a passkey. The returned owner review
URL is a locator, NOT an authorization token: viewing and approval still
require the independently authenticated owner session, CSRF and UV-verified
physical passkey. An approved PostgreSQL receipt still has to be consumed
once by Cloud's independent receipt-consumer role.

`src/http.ts` now requires the explicitly injected trusted
`ownerIntentDelivery` before `/prepare` can return an HTTP 200. Failed
HTTPS delivery, missing service wiring and expired intents fail closed
without exposing a usable request ID. **Neither Cloud main.ts nor the
standalone acceptance CLI wires the signer/receiver or loads their keys**:
these are testable library contracts, NOT deployed production endpoints.
No signing key is created or persisted in this repository. Production key
provisioning, trusted Cloud source identity, independent owner DNS/OAuth app,
passkey activation, real operator and hardware KiCad E2E still require
separate acceptance. The release remains **NO-GO**.

### Optional owner HTTPS host composition is not live activation

The standalone `createOwnerAcceptanceServer` can now be constructed with
an explicitly provided `approval` dependency, whose two components are
the pinned-signature Cloud intake and the independently session-gated
review handler. This enables end-to-end *synthetic* HTTPS acceptance tests
without crafting a weaker test-only server. The default `owner:acceptance`
CLI and Cloud `main.ts` do not provide it. The default owner host continues
to return `approval=disabled` and HTTP 404 for internal intent and review
routes; no uncontrolled feature flag makes them public.

The actual-host integration also proves that a valid Better Auth session
owned by another person and a revoked original owner session cannot use
the signed request. Cloud's Ed25519 signature only authenticates the
request scope, **not the human**, and cannot mint a receipt by itself.
Issuer-only PostgreSQL rights and UV-verified WebAuthn remain mandatory.
No production release or deployment is permitted from this draft.

### Independent owner issuer process (not a live Cloud route)

The opt-in owner:issuer executable has its own OWNER_REVIEW_* settings,
separate OAuth identity, three independently restricted SQL principals,
pinned Cloud Ed25519 public key and an exact HTTPS origin. Its role
preflight rejects approval-consuming or passkey-activating privileges.
Only a previously enabled owner passkey can issue one scoped receipt.
The passive-only owner:acceptance executable and the Cloud production
main.ts entrypoint are unchanged. Real human, key, local device and live
WSS acceptance gates still apply. NO-GO for production or merging #64.
