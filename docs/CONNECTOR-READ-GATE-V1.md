# Atomic read-only connector admission — isolated security contract

This increment is intentionally **not an API endpoint, WebSocket relay, KiCad
executor, browser consent, or permission to use project files**.

A future authenticated transport must supply the *trusted* OAuth owner,
AI-client ID, already-validated access-token issue time, enrolled device,
active session ID and the server-owned per-socket connection binding.
Untrusted request frames cannot choose these identities.

`PgConnectorReadGate.verifySignedRead` takes the exact 8 KiB-or-smaller
signed JSON wire bytes and an Ed25519 signature. It rejects malformed or
expired data and, within **one PostgreSQL transaction**:

- Holds enabled, unrevoked device and credential locks, then active session.
- Validates the server-owned connection binding and next event sequence.
- Rechecks the database clock and bounded request deadline.
- Verifies an Ed25519 signature over owner, AI-client ID, device, session,
  connection binding, sequence and SHA-256 of the **exact wire bytes**.
- Checks the per-client OAuth revocation cutoff (before grant locking, to
  preserve lock ordering), linked project enablement and enabled per-client
  grant in the same transaction.
- Enforces the existing strict v1 connector envelope, allowing only
  `project_summary`, `run_drc`, `run_erc`, and a deadline <=30 seconds.
- Only then advances the session sequence. Denied requests do not consume it.

The result is a **preflight admission**, not a durable execution capability.
Any eventual dispatch must recheck current policy when it actually crosses
the Cloud-to-local boundary, and the local KiCad connector must independently
enforce its project allowlist and write-consent policy. The three operations
are read-only. No generic native KiCad tool is made available.

No database schema changes or production migration are introduced.

## Still required for production

Actual outbound authenticated TLS/WebSocket device connection, server-owned
connection identity, browser CSRF/session and login, OAuth issuer/client
acceptance, per-device/project/source rate limits, local KiCad allowlists,
disconnect/cancel/reconnect, command acknowledgement and expiration handling,
and end-to-end tests with a real KiCad engine. Do not expose this library as
a public route or remote execution authorization without those gates.
