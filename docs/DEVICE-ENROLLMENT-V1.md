# Atomic, revocable device enrollment — security review draft

This change is stacked on PR #21, which itself depends on PR #20. It is **not a
production device-enrollment feature**; no network endpoint, browser review
handler, credential-using connector or KiCad operation is enabled.

## Transactional enrollment

After an independently authenticated browser user has approved a challenge,
a device must present the one-time device code AND an Ed25519 signature over
the domain-separated proof. On enrollment, one PostgreSQL transaction:

1. Locks the approved challenge row and reads the DB clock after the lock.
2. Verifies owner binding, expiry, code MAC and Ed25519 signature.
3. Inserts a new opaque device row with `enabled=false`.
4. Inserts its associated public-key credential, bound by composite
   owner/device FK and a UNIQUE challenge and public-key fingerprint.
5. Marks the challenge consumed before commit.

Every failure rolls back all three changes. Concurrent enrollments serialize;
the same challenge cannot create two devices. A second approved challenge
with a previously enrolled public key cannot create a duplicate credential.
No server-minted bearer secret is needed; the private key remains local.

## Owner revocation

`revokeDevice` requires a **previously verified owner ID**, locks the
device/credential rows, permanently timestamps credential revocation, disables
the device, all of its projects, and their client-specific grants in one
transaction. A foreign owner does not learn the device state. It is safe to
retry and never restores a revoked credential.

`activeDevicePublicKey` only returns the stored public key for a device
which is enabled AND unrevoked AND belongs to the provided owner. Merely
retrieving a key is NOT authentication. The future connector must verify a
fresh, nonce-bound Ed25519 challenge with server-side replay prevention,
enforce current policy and disconnect sessions on revocation.

## Acceptance still open

- Real browser identity/session and CSRF controls; anti-enumeration,
  code guessing rate limits, authenticated owner enable/revoke management.
- Credential key rotation, replay-proof outbound TLS connection handshake,
  heartbeat and cancellation; read-only project-level enforcement in both
  Cloud and local engine.
- Real Google/GitHub provider OAuth login and ChatGPT/Claude host acceptance.
- Production-safe migration 008 deployment, backup/restore rehearsal,
  privacy/logging review and end-to-end testing with a real KiCad device.

Tests use disposable PostgreSQL schemas; no production DB mutation,
second staging environment, app deployment or extra image retention.
