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
