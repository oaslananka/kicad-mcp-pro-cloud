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
