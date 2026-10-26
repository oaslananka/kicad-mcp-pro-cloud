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
