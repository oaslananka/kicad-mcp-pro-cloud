# Pairing challenge persistence — draft (no enrollment endpoint)

This is a stacked PR on the unmerged device-pairing primitive (#20). Migration
007 and the PostgreSQL store implement metadata-only, serializable-per-row
transitions, not a production pairing workflow.

- PostgreSQL `SELECT ... FOR UPDATE` serializes approvals, wrong-code attempts
  and signature-based redemption across competing application workers.
- The database clock is read **after** acquiring the row lock, so an expired
  challenge cannot become valid merely by waiting for contention.
- Each challenge transitions within the same transaction; the first legitimate
  redemption wins, subsequent attempts fail. No real device is enrolled.
- Device-specific secrets and human-readable user codes are never persisted;
  separate keyed HMAC digests are stored. No local KiCad paths/files.
- New versioned migration is not automatically run or deployed.

Security acceptance still required: authenticated browser session, CSRF,
rate limiting and code lookup UX, phishing resistance, independent device
credentials/revocation, cancel/reconnect, real host and device acceptance,
production backup/restore validation. A successful redemption currently
returns only an owner binding. A separate provisioning transaction must later
atomically couple consumed challenges to revocable device credentials, with
crash-safe idempotency; that contract is explicitly out of scope.
