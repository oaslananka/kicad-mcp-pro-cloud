# Feature-gated device-side pairing bootstrap (not enabled in production)

This Cloud-only increment completes **the transport surface** of the existing
five-minute pairing state machine and browser approval contract. It does not
provision production credentials, enable a device, connect to a physical KiCad
engine, grant AI clients projects, or forward any native tool operation.

The HTTP pairing routes are **not wired by default**. They require
`PAIRING_DEVICE_API_ENABLED=true`, a configured built-in identity service,
and a verified HTTPS public origin. These gates do not imply deployment
approval. Current production configuration keeps the built-in provider
inactive, so they cannot be activated there by code merge alone.

## Device-initiated contract

Requests must be TLS-protected POST JSON from a non-browser client; the
server rejects browser Origin, cookies, Authorization, Sec-Fetch-Site,
URL parameters, non-JSON content and bodies larger than 1 KiB.
No remote address supplied in HTTP headers is trusted.

1. `POST /api/v1/pairing/device/challenge` with
   `{ "alias": "Lab KiCad", "publicKeyDer": "<base64 Ed25519 SPKI DER>" }`.
   Returns HTTP 201 with an opaque challenge UUID, human user code,
   **one-use 256-bit device code**, public key fingerprint and expiration.
   Both codes must remain exclusively on the device. The human separately
   enters the challenge UUID plus the short code at the first-party
   `/devices/pairing` page after authenticated owner login.
2. An independent owner browser session and CSRF-protected action approve
   or deny the challenge. The code never authorizes enrollment by itself.
3. Optional device-side status check: `POST /api/v1/pairing/device/status`
   accepts `challengeId`, `deviceCode` and a distinct Ed25519 signature
   over `pairingStatusProof(challengeId, deviceCode)`. It returns only the
   read-only boolean `approved`; it never authorizes/consumes enrollment.
   Invalid secrets and signatures fail closed. The client must check no more
   than every 8 seconds, stop at the existing 5-minute deadline and perform
   the separate signed redeem only after the real owner's browser approval.
   Each verified ingress source and challenge may use at most 40 status checks
   per 15-minute budget window (PostgreSQL counters are capped at 41).
   Owner-only WAF pilot rules MUST include this additional /status route
   alongside challenge, redeem and connector/ws, before flags are enabled.
4. `POST /api/v1/pairing/device/redeem` with
   `{ "challengeId": "<uuid>", "deviceCode": "<base64url>",
   "signature": "<Ed25519 signature base64url>" }`.
   The signature covers `redemptionProof(challengeId, deviceCode)` using
   the device's private Ed25519 key. Cloud verifies the stored public key,
   approved owner, code digest and expiry under PostgreSQL row lock.
   A single transaction consumes the challenge and inserts a
   **disabled** device and revocable public-key credential; replay loses.
   Replies contain only device ID, fingerprint and `enabled:false`.

Device private keys, source IP addresses, user codes, project files and
local paths are never saved as plaintext Cloud metadata.

## Anti-abuse and limits

Migration 012 introduces PostgreSQL-backed 15-minute shared counters
(keyed HMAC digests rather than raw client identifiers). They fence:

- Twelve challenge attempts per connecting TCP peer.
- Three challenge attempts per public-key fingerprint.
- Forty redemption attempts per connecting TCP peer.
- Eight redemption attempts per challenge UUID.

These limits are independent from the existing ten owner reviews per
five minutes (migration 011) and five wrong codes per challenge.
Counters saturate; worker concurrency cannot reset their window.
All browser owner decisions still require Better Auth user + session,
CSRF and Origin checks. Unknown challenges are charged against rate limits.

**Critical production limitation:** The trusted TCP peer may be a reverse
proxy rather than the true device IP. Therefore this gate intentionally
does *not* enable production issuance without separately verified trusted
ingress source identification, distributed edge throttling, monitoring,
bounded budget-table cleanup and controlled rollout. Do not trust
X-Forwarded-For supplied by a client as identity, and do not let direct
Internet traffic bypass the trusted edge. Real user enrollment UX, Ed25519
key custody/rotation and physical local-device interoperability are
separate acceptance work.

No Cloud production migration 012, OAuth provider setup, WebSocket activation,
deploy or cross-repository modification occurs with this PR.


### Trusted origin source gate

When enabled, the pairing API additionally requires the exact trusted
Cloudflare Tunnel peer allowlist `TRUSTED_CLOUDFLARED_PEERS`, and a unique
valid `CF-Connecting-IP` header from that known TCP peer. No origin
headers are accepted from other peers; arbitrary X-Forwarded-For claims
are ignored. See [trusted ingress source](TRUSTED-INGRESS-SOURCE.md).
