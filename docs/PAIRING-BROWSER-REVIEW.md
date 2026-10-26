# Browser pairing review: default-off, bounded approval

The built-in Better Auth provider must be configured and independently
accepted before any browser pairing review is accessible. In current
external authentication mode, the browser routes are not forwarded.

GET /devices/pairing requires a verified first-party user and session.
The form asks for an existing challenge UUID and 12-character user code
shown on the enrolling device. It does not create challenges or enroll devices.

POST /devices/pairing/review requires strict same-Origin, bounded form
fields and an HMAC-signed CSRF token bound to the browser user and
session, plus a separate HttpOnly, SameSite=Strict state cookie.
The entered code is never placed in a response URL or application log.
Approval is terminal, but alone never creates device credentials.

Migration 011 creates an atomic per-owner budget of ten reviews per
five-minute window, shared across app replicas; missing challenge IDs
also consume the budget. Each challenge has its own five-guess lockout.
Only the one-use private-key proof can later create a disabled device.

This does not substitute ingress/IP throttling, old budget cleanup,
trusted device challenge issuance, or an independently authenticated
device redemption transport. None of those are activated in this PR.

Release gates: registered production social OAuth providers, actual
AI-host OAuth acceptance, server/ingress throttling, audited migrations
and backup/restore, physical outbound connector tests, secure enrollment
and project consent. No local KiCad tool, project path or file transfer
is implemented or authorized.
