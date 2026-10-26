# Device enrollment security primitive — isolated prototype

Status: **not connected to HTTP, OAuth, PostgreSQL or an actual local client**.
This module does not enroll devices, issue credentials, open a relay, mutate
project grants or change production behavior.

The new `src/device-pairing.ts` models a single-use browser-approved pairing
challenge. Device pairing is **distinct** from ChatGPT/Claude's OAuth-protected
MCP authorization; do not treat MCP sessions or connector message fields as
identity proof.

## Design decisions

- A user-triggered local agent generates an Ed25519 keypair; Cloud receives
  the public SPKI DER bytes and a benign alias, never the private key.
- Cloud returns a random 12-character base32 user code (display as six-six),
  a distinct random 256-bit device code (delivered only to the requesting
  device) and a five-minute expiry.
- Only domain-separated, server-keyed HMAC digests of both codes are stored
  in the pairing record. The server key must be external secret configuration.
- The browser must already have an independently authenticated user session,
  strong CSRF defenses, a displayed device alias/code/fingerprint and an
  explicit approve/deny choice. The user code is limited to five attempts.
- Redemption demands the high-entropy device code **and** an Ed25519 signature
  over the pairing ID and device code. A browser code or approval alone cannot
  mint a device credential. Successful redemption consumes the challenge.
- Expired, denied, locked and consumed challenges are terminal. No remote
  project is automatically shared when a device is paired.

This design borrows security and UX considerations from
[RFC 8628](https://www.rfc-editor.org/rfc/rfc8628), but is **not** a complete
implementation of the OAuth Device Authorization Grant and must not be
advertised as standards-compliant device OAuth.

## Required integration before shipping

1. Implement persistent PostgreSQL challenge storage and **atomic row-level
   compare-and-swap** or `SELECT … FOR UPDATE` transitions. This isolated
   state machine cannot prevent two distributed workers redeeming the same
   stale approved state.
2. Bind creation/approval/redemption to per-IP/device/user throttling and
   anti-enumeration controls; enforce the five-attempt budget atomically.
3. Implement authenticated browser-only review and CSRF-resistant confirmation.
   Confirm physical device possession; warn against remote phishing.
4. Provision revocable device credentials **only after** the atomic redemption
   transition and successful key proof. Rotate and revoke them independently
   from MCP OAuth client access.
5. Separate approval state from device online/connected status; heartbeat TTL,
   disconnect, privilege scopes and project-specific permissions require
   their own verified implementation.
6. Use a secure transport and prevent secret/code/body logging. Keep the
   device code only in transient local secure storage.
7. Add actual HTTP, PostgreSQL concurrency/race, replay, crash, rate-limit,
   host/client and physical KiCad tests. All current tests are isolated
   deterministic state-machine tests; they do not prove production pairing.

Failure to meet any of these gates means no production device enrollment.
