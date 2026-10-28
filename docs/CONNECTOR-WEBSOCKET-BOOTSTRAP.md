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
When the local device replies, the Cloud transport checks the exact
request/project identity and deadline, then asynchronously revalidates the
owner/OAuth-client project grant and active device binding in PostgreSQL.

**A passing database query is not an extension of the original deadline.**
If the query finishes after the original request deadline or after the
bounded device session expires, the server discards the result, closes
the WebSocket with policy code 1008, and sends **no**
`connector.read_ack` or HTTP data. Both deadlines are rechecked
**after** the awaited authorization and before the ACK. The HTTP handler
independently rechecks JWT expiry, token cutoff and the current
project/device grant before sending an HTTP result.

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
The separate twelve-second post-dispatch watchdog still applies to
the subsequent one-shot read and final revalidation. Real DB queries
may continue server-side after their caller times out; database-level
query timeouts remain an independent operational control.

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
