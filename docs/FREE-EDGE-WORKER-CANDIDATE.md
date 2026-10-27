# Free-tier edge Worker candidate — intentionally NOT deployed

This Cloud-only source candidate lives in
`infra/edge-worker/candidate.mjs`. It has no Wrangler deployment config,
no enabled routes, no DNS change, and no access to production secrets.
It is not an authorization to deploy a Worker.

## Why consider it?

Cloudflare's Free Website zone `oaslananka.dev` has one existing WAF
rate-limiting rule, the unrelated leaked-credential check. It must not
be changed or removed to gain an additional KiCad rate-limiting slot.
Cloudflare separately documents a **Workers Rate Limiting binding API**
that can apply endpoint-specific, approximate per-location quotas.
The documented Workers Free plan provides 100,000 requests/day shared
across the account (including other Workers/Pages Functions). **The
availability and usable entitlement of Rate Limiting bindings on this
specific account is not yet confirmed.** No plan or paid feature is
automatically enabled.

## Candidate behavior

The Worker handles ONLY these exact HTTPS hostname/method/path tuples:

- POST /api/v1/pairing/device/challenge
- POST /api/v1/pairing/device/redeem
- GET /api/v1/connector/ws with WebSocket Upgrade

For each, the Worker checks **two independent binding budgets**:
a source-address-scoped budget and an endpoint-global budget. Separate
namespaces and bound threshold values must be configured and reviewed
per binding; the code carries no privileged keys, tokens, or default
live threshold. Wrong routes, protocol, method, query or Upgrade are
rejected; missing/unparseable source, unconfigured binding or binding
failure all fail closed. Quota denial yields 429. A successful request
is forwarded without rewriting hostname, authorization or source
headers. No local project paths, metadata, device credentials or
response bodies are logged.

This is **approximate, per-Cloudflare-location** throttling, NOT an
account-wide strict quota or identity authorization. Multiple source IPs
can evade per-IP budgets and mobile/corporate networks share source IPs.
The endpoint-global budget prevents an unlimited number of unrelated
actors from exhausting the origin in a single Cloudflare PoP. The
origin's PostgreSQL abuse budgets, owner consent, Ed25519 proofs and
other device gates are all independently required.

## Release blockers (none bypassed by this candidate)

1. **Entitlements and cost:** Verify this account supports Workers
   Rate Limiting bindings *without any paid-plan change*, current
   account-wide Workers Free usage and failure behavior if the
   100k/day quota is reached. Never deploy a Worker that silently fails
   open after quota exhaustion or creates a billable tier.
2. **Source-header authenticity:** A Worker subrequest through a
   Cloudflare Tunnel may change `CF-Connecting-IP` or related headers,
   depending on routing and Worker behavior. The Cloud origin's exact
   trusted-proxy source resolver must see **authentic end-user IP**
   with no spoof/bypass possibility. This must be tested with two
   independent public client networks and real HTTP/WSS Upgrade
   before considering live route cutover.
3. **Route specificity:** Confirm only the three KiCad endpoint
   paths are bound to the Worker, with no route on other applications,
   OAuth callbacks, MCP discovery, static assets, or general KiCad
   routes. Validate that the Worker fetch subrequest reaches the
   dedicated KiCad Tunnel origin without route recursion.
4. **Dedicated Tunnel:** The new remotely-managed KiCad-only Tunnel
   (`2cab4780-0ca4-45bf-90f2-dfc3017dee19`) currently has only
   a fallback 404 and is inactive; it has **no public hostname or
   connector**. Preserve the old shared Tunnel and its three unrelated
   routes. Verify isolated private bridge, static TCP peer, and tested
   network/DNS rollback before any cutover.
5. **Rules preserved:** The existing leaked-credential rule must
   remain enabled and unchanged. A Worker cannot be counted as a
   replacement for that rule. Existing offline
   `cloudflare-edge-contract.mjs` is based on WAF rules; it deliberately
   **continues to block** this unaccepted Worker alternative until
   authentic live Worker rate-limit/route evidence is independently
   added and reviewed.
6. **Product readiness:** Production DB is still at 006, device API
   and WSS flags are OFF; encrypted independently recovered offsite
   backup and production migrations 007–012, actual Google/GitHub
   OAuth credentials and complete client interoperability are pending.
   Do not enable device endpoints as a side effect of testing a Worker.

## Offline verification only

```bash
node --test scripts/test-edge-worker-candidate.mjs
npm run check
```

These unit tests use mocked binding counters and an in-memory
forwarding function. They prove no Cloudflare entitlement, no real
edge quota accuracy, no true header preservation, and no live
WebSocket interoperability. The `candidate.mjs` file is the ONLY
Worker source proposed and is not attached to a Wrangler route or
deployment workflow.

Cloudflare docs (reviewed 27 October 2026):

- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/fundamentals/reference/http-headers/
