# Bound connector sessions — isolated, stacked prototype

This is a draft on top of PR #23, which depends on #22 → #21 → #20. No public
endpoint, TLS/WebSocket transport, OAuth session, KIcad operation or production
migration is enabled.

`connector_sessions` (migration 010) holds only opaque IDs, an owner/device
binding, a one-use challenge ID, a SHA-256 digest of the server-generated
per-connection random binding value, timestamps, state and last accepted event
sequence. No KiCad paths/files, connector payloads, session bearer tokens or
private signing keys are stored.

An unrevoked, **explicitly enabled** device can begin a single pending session:
within one DB transaction a 60-second Ed25519 challenge and five-minute
pending session are inserted. The transport must retain the server-generated
connection binding in its own trusted per-socket state; it must never accept a
client-chosen cookie, URL, body field or header as authoritative binding.

To activate, the device signs a domain-separated message over session ID,
challenge ID, device ID, nonce and binding. The verifier holds the same
device/credential row locks as revocation, checks DB time after locking, checks
binding+nonce hashes and Ed25519 signature, consumes the challenge, and marks
the session active in **one transaction**.

Each candidate metadata event is signed over the session ID, device ID,
binding value, monotonically increasing sequence and the SHA-256 of the actual
raw bytes. The DB accepts only the next sequence after a current revocation,
enabled-state and expiry check. Accepted events only prove origin, session
binding and replay exclusion. They do **not** authorize projects, grant tool
execution, or create Cloud→local reachability.

Revocation must atomically close all active/pending sessions. A session is
never an OAuth bearer token; an accepted event must still undergo OAuth client,
device, project, capability and local interactive write-consent checks before
any KiCad action. Reconnect requires a new handshake.

## Unmet acceptance gates

- Actual outbound TLS/WebSocket transport with server-controlled, non-transferable
  connection binding and server-verified handshake context; no untrusted
  caller-supplied owner/identity. TLS exporter channel binding if deployed
  requires a separate design and client/server interoperability verification.
- Device-origin nonce issuance throttling and anti-enumeration, authenticated
  browser CSRF controls, rate-limited pairing and owner/device management.
- Real command framing, canonical payload serialization, timestamps,
  cancellation, disconnect/reconnect, heartbeat and lease renewal semantics.
- Physical KiCad and real ChatGPT/Claude OAuth host interoperability;
  deny-by-default intersection of local/Cloud/client project grants.
- Review migration 010 for backup/restore and explicit production application.
  No persistent staging or retained rollback images.
