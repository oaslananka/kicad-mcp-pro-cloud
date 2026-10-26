# One-use Ed25519 device handshake proof — draft security boundary

This PR is **stacked on #22**. It is not an HTTP endpoint, session
authentication, authorization policy, local connector or KiCad execution.

A previously enrolled and **explicitly enabled**, unrevoked device may
obtain a single random 256-bit nonce bound to its owner and device ID. The
nonce is returned once and stored only as its SHA-256 digest. Its expiry
is 60 seconds, with at most one pending challenge per device.

The device signs the exact, domain-separated message
`kicad-cloud-device-handshake-v1\0{challengeId}\0{deviceId}\0{nonce}`
using its local Ed25519 private key. The verifier transaction locks both
the device and credential, then the challenge; checks current database
time, owner, device ID, canonical nonce and public-key signature; and
consumes that challenge once. Five failed proofs lock the challenge.
A separate device ID, a previous nonce or a foreign owner's signature
cannot successfully replace the expected proof.

Revocation takes the same device+credential locks, denies the key and
invalidates outstanding challenges before commit. A proof event that
finishes immediately before revocation is **not a surviving session**:
any future transport must recheck live revocation, enabled state and
per-project/AI-client grants at every authorization boundary.

## Required work before exposing any endpoint

- Authenticate the device/owner scope before challenge issuance, enforce
  per-source and per-device throttling and ensure TLS transports do not log
  nonce, signature, header or credential materials.
- Add a session identity protocol bound to one specific TLS connection or
  session, with nonce/signature validation coupled to that session. This
  isolated verification result alone is **not** a reusable credential.
- Authenticate MCP/OAuth user and AI-client identity independently and
  enforce both Cloud and local read/write grants. Do not run KiCad tools
  based on a successful device handshake alone.
- Test disconnect/reconnect, heartbeat TTL, cancellation, crash recovery,
  deployed revocation races, real Google/GitHub sign-in and actual clients.
- Validate migration 009 with backup/restore and operator-reviewed
  deployment. No staging or production changes are introduced here.
