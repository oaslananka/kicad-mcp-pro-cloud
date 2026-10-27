# Cloud readiness gates

## Foundation — this PR
- [x] Real MCP v2 Streamable HTTP endpoint, JSON results, safe tool metadata
- [x] OAuth protected resource metadata and strict JWT verification
- [x] Read-only inventory with per-owner filtering; schema excludes KiCad files/paths
- [x] Cross-user isolation and malformed/unauthed request tests
- [ ] CI and runtime test evidence (checked as part of review)

## Identity + durable control plane — NOT IMPLEMENTED
- [ ] Choose and deploy a standards-compliant OAuth authorization server (PKCE S256, CIMD), identity linking Google/GitHub and sign-out/revoke
- [ ] Bind user identity to device enrollment using short-lived pairing, per-device credentials, rotation, expiry and revoke
- [ ] Device and project management CRUD, cross-owner validation, audit log and concurrency policy
- [ ] Persisted migrations, rate limits, pagination, administrative lifecycle and backup/restore verification

## Remote local bridge — NOT IMPLEMENTED
- [ ] Outbound TLS connector with mutually authenticated device identity; heartbeat, reconnect, bounded payloads
- [ ] Local project path verification and isolation per authenticated execution, no raw remote path execution
- [ ] Per-project read/write/manufacturing policy intersection enforced at relay and local engine
- [ ] Request cancellation, idempotency, offline errors and crash recovery
- [ ] Real ChatGPT and Claude web → one physical local KiCad device ERC/DRC proof

## Productization — NOT IMPLEMENTED
- [ ] Authenticated web dashboard, CSP/CSRF protection and accessible onboarding
- [ ] MCP Apps read-only project selection/DRC widget with non-UI fallback, real host acceptance
- [ ] Skill import from canonical local repository (do not copy an editable second source)
- [ ] Reproducible deployment, observability, threat model review, privacy and release documentation
- [ ] Production domain verification, external plugin reviews, end-to-end and rollback evidence

**Do not treat a green CI workflow as any unverified acceptance gate.**

## Issue #2 incremental progress
- [x] Default-deny, per-OAuth-client project/device discovery.
- [x] Scoped, first-party-only project-client grant mutation endpoint and audit.
- [x] Separate first-party management-client allowlist from ChatGPT/Claude tool clients.
- [ ] Actual IdP, provider-specific signed client_id mapping, login UI and social identity link.
- [ ] Device pairing, revocation, controller/project APIs and real connector.
- [ ] Public app, deploy, rollback, privacy and acceptance tests with physical KiCad.
No overall DoD is considered met by the above partial implementation.

## Identity / deploy foundation
- [x] Optional Better Auth + MCP + CIMD integration; disabled by default
- [x] Strict OAuth configuration contract, encrypted provider tokens,
      RS256 JWT keys and explicit no-implicit-link policy
- [x] Schematised identity migration and ephemeral PostgreSQL metadata tests
- [x] Secret-free OCI image build and documented OpenTofu adoption conditions
- [ ] Register real Google/GitHub apps in development, staging and production
- [ ] Implement and validate login, account-linking and OAuth consent UI
- [ ] Validate real PKCE/CIMD access-token flows and ChatGPT/Claude clients
- [ ] DPoP-aware resource verification for bound tokens (currently denied)
- [ ] Select/provision secure production runtime, perform DB restore, rollout
      and rollback acceptance (not done)

## Browser login increment
- [x] Server-rendered Google/GitHub login with provider redirect restrictions,
      same-origin POST and signed OAuth query verification
- [x] Authenticated account landing page with no-session redirect
- [x] Unit and ephemeral PostgreSQL-backed authorization initiation tests
- [ ] Verified client-specific consent page and grant/revoke flow
- [ ] Real provider registration and social callback acceptance
- [ ] ChatGPT/Claude real OAuth interoperability, session rotation
- [ ] Device pairing, project dashboard, local KiCad connector and production deploy

## OAuth consent increment
- [x] Signed, expiring query and authenticated-session verification
- [x] Real client metadata lookup, escaped scope/claims and explicit allow/deny
- [x] CSRF nonce/HMAC, no automatic project permissions and limited management scope
- [x] Fake-provider unit tests and HTTP fail-closed tests
- [ ] Real provider authorisation end-to-end and client-specific consent acceptance
- [ ] UI to review/revoke consents and disable client project grants together;
      check existing access-token validity separately

## Client connection revocation
- [x] Session-required listing of OAuth consents
- [x] Owner-bound, CSRF-protected revoke action with verified client ID
- [x] Transactionally disable all matching project-client grants before
      deleting consent, with metadata-only audit
- [x] Unit, HTTP and PostgreSQL grant revocation tests
- [ ] Revoke outstanding refresh token families / define hard JWT cutoff
- [ ] End-to-end browser login, OAuth callbacks and host token refresh tests
- [ ] Device/local-connector permission enforcement, real client acceptance

## Token lifecycle increment
- [x] Signed JWT iat required and online per-client cutoff on MCP and management API
- [x] Atomic grant disable + Better Auth refresh/opaque-token revoke (builtin mode)
- [x] Clear refresh-token rotation replay caches; preserve other owners/clients
- [x] New versioned migration 005, PostgreSQL security tests
- [ ] Real issuer refresh rotation/replay and concurrent cutoff acceptance tests
- [ ] Real Google/GitHub callback + ChatGPT/Claude/other hosts E2E
- [ ] Local connector and execution cancellation using live authorization

## Migration rollout safety
- [x] Explicit status/apply CLI; checksum ledger; transaction/advisory lock
- [x] Disposable PostgreSQL repeatability, contention, tamper tests
- [ ] Backup/restore drill in the chosen staging deployment destination
- [ ] Staging schema migration and rollback/recovery acceptance evidence

## Issue #9 refresh/revocation concurrency
- [x] Real Better Auth refresh grant, rotation replay and post-revoke tests
- [x] Deterministic delayed-successor interleaving with user/client revocation
- [x] PostgreSQL advisory fence for late token INSERT and replay UPDATE
- [x] Protect old authorization-code lineage after fresh consent
- [x] Migration 006, disposable Postgres CI coverage and version pin retained
- [ ] Controlled production-friendly OAuth invalid_grant for trigger denial
- [ ] Real provider login/authorization-code and explicit re-consent callback
- [ ] Host refresh/retry acceptance across ChatGPT, Claude, Gemini and Grok
- [ ] Real release staging, restore and migration rollback/recovery drill

## OAuth provider error mapping increment
- [x] Only fenced late refresh maps to HTTP 400 invalid_grant
- [x] Real Cloud HTTP server + pinned Better Auth + temporary PostgreSQL test
- [x] Concurrent request-local error isolation, other failures stay HTTP 500
- [ ] Real social-provider authorization-code exchange and fresh account consent
- [ ] ChatGPT/Claude end-to-end reauthorization UX, followed by other hosts

## OAuth 2.1/PKCE local protocol acceptance
- [x] Real Better Auth authorize to signed login redirect
- [x] Google/GitHub login initiation preserves signed client request
- [x] Authenticated consent, code exchange and MCP-bound access token
- [x] Reused code and mismatched fresh-code PKCE verifier rejected
- [ ] Google/GitHub live callback in private staging
- [ ] ChatGPT/Claude live MCP pairing, refresh and reconnect
- [ ] Gemini/Grok compatibility based on verified host capabilities
- [ ] Local connector and real project authorization


## Authenticated device management increment (revoke only)

- [x] Built-in browser-session-only device listing, escaped metadata, no
      false online status and default-deny when the built-in provider is off.
- [x] Owner/CSRF/Origin-bound irreversible device revocation shared with
      pairing-store transactions, including live session and project/client
      permission cutoff; browser and PostgreSQL tests.
- [ ] Complete rate-limited authenticated pairing invitation and approval UX;
      safe device enablement, key rotation, and project onboarding.
- [ ] Live provider sign-in/host interoperability and production acceptance.

This increment makes no claim that actual local KiCad devices are linked
or production enrollment is available.


## Browser pairing review and abuse controls (pre-enrollment)

- [x] Authenticated, same-origin browser review for existing challenges;
      5-minute session-bound CSRF state and exact form fields.
- [x] PostgreSQL owner budget: ten attempts per five minutes, serialized
      across replicas, including unknown challenge IDs, plus five attempts
      per challenge.
- [ ] Trusted, rate-limited device challenge issuance and redemption transport.
- [ ] Real OAuth provider/AI-host acceptance, production migration,
      physical device compatibility, rollout approval.


## Device pairing HTTP bootstrap (disabled by default)

- [x] Optional Cloud-only device challenge and Ed25519 redemption HTTP
      interfaces with strict small JSON frames, no browser/user identity
      headers, five-minute/one-use enrollment and disabled devices.
- [x] Migration 012: HMAC-keyed PostgreSQL per-source/per-key/per-challenge
      distributed issuance/redemption limits, concurrent race tests and
      disposable backup/restore checks.
- [ ] Trusted ingress source-IP/edge rate-limit acceptance and budget cleanup.
- [ ] Real owner login + native device onboarding and secure local key custody.
- [ ] Verified production migration/deployment and physical KiCad E2E.


## Trusted Cloudflare Tunnel source (not deployed)

- [x] Cloud-only exact TCP peer allowlist + unique Cloudflare source header,
      IPv6-canonicalized abuse budget key and fail-closed HTTP/WSS behavior.
- [ ] Verify real tunnel peer topology, header authenticity, isolation and
      direct-origin bypass prevention in production.
- [ ] Independently configure distributed edge rate limits and inspect
      Worker/Transform behavior before enabling any device feature.

## Isolated tunnel topology acceptance

- [x] Cloud-only read-only Docker topology verifier and adversarial tests for private, pinned, two-container ingress and no app port publishing.
- [ ] Controlled non-disruptive migration from shared tunnel bridge to an isolated Cloud-specific ingress path.
- [ ] Cloudflare edge WAF rules, source header authenticity, WebSocket real-user acceptance and rollback evidence.


## Verified Cloudflare live edge acceptance (read-only)

- [x] Audit current KiCad hostname DNS, shared Tunnel route, zone plan and
      WAF rule inventory without touching other Cloudflare apps.
- [x] Offline, non-secret, fail-closed edge acceptance contract with
      adversarial tests on DNS, dedicated routing, WAF rule capacity,
      endpoint method/path protections and unverified header provenance.
- [ ] Preserve current Free-tier leaked-credential WAF rule and obtain
      independently verified plan/rule capacity before adding KiCad edge
      rate protection. Do not replace unrelated security rules.
- [ ] Deploy and accept KiCad-only Tunnel, isolated origin, route and
      distributed endpoint rate limits with tested recovery/rollback.

## Database recovery status — 27 Oct 2026

- [x] Fresh authenticated age-encrypted production snapshot.
- [x] Full restore to isolated PostgreSQL 17 RAM with core metadata
      and OAuth trigger/ledger verification.
- [ ] Independently recovered offsite encrypted backup and full restore.
      Agent-mediated R2 transfer was blocked by tool safety policy.
- [ ] Controlled production migrations 007–012 after offsite recovery.

- [x] Actual encrypted production snapshot migrated 006 to 012
      in disposable PostgreSQL 17 RAM; source metadata preserved,
      replay idempotent and live schema still 006 (27 Oct 2026).

## Free edge rate-limit exploration

- [x] Prepare Cloud-only, **not deployed**, endpoint-scoped Worker
      Rate Limiting binding candidate with two budgets per endpoint,
      fail-closed behavior and offline adversarial unit tests.
- [ ] Confirm Workers Free entitlement for Rate Limiting binding,
      account-wide daily capacity and hard no-charge behavior.
- [ ] Independently verify Worker -> dedicated Tunnel source header
      authenticity, WebSocket Upgrade, no request recursion and route
      scoping before extending the edge readiness contract or enabling
      any public endpoint.

## First working login: GitHub alone is sufficient

- [x] Accept one complete social OAuth provider and hide disabled routes.
- [ ] Register real GitHub OAuth client, save Doppler credentials, and
      activate built-in identity with live user consent tests.
- [ ] Google can be enabled later; not an MVP prerequisite.
