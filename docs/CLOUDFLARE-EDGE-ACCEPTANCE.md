# KiCad Cloud — Cloudflare edge release acceptance (no live changes)

This is a **read-only evidence contract**, not a Cloudflare ruleset
deployment. It does not retrieve tokens, modify the shared Tunnel, update
DNS, change app or PostgreSQL config, or enable pairing/WSS.

## Last live read-only observations — 27 October 2026

The connected Cloudflare API for the actual `oaslananka.dev` zone reported:

- Zone plan: **Free Website** (not a confirmed paid WAF subscription).
- `kicad-mcp-pro.oaslananka.dev` is a **proxied CNAME** to a Cloudflare
  Tunnel target. The `oaslananka-ops2` remotely managed Tunnel is
  **healthy with four connections**.
- The Tunnel has **five ingress entries**: the single KiCad hostname route
  to `http://kicad-cloud-app-1:8787`, **three unrelated hostname routes**,
  and a fallback. Therefore it is **shared**, not a dedicated KiCad Tunnel.
- The `http_ratelimit` ruleset contains **one enabled rule**:
  `Leaked credential check`, action `block`, 5 requests / 10 seconds
  keyed by `ip.src` and `cf.colo.id`. It is **not** a KiCad-specific
  enrollment or WebSocket limiter. Preserve it.
- There are no zone Worker routes. The `http_request_transform` and
  `http_request_late_transform` phase entrypoints returned not-found or
  unavailable. That does **not** independently prove the absence of every
  account-level rule, other indirect routing, or Worker subrequest.
- No production traffic, direct-origin bypass, header rewriting,
  supported device NAT patterns or real WebSocket Upgrade behavior
  was intentionally exercised in this inspection.

**Important capacity conflict:** Cloudflare's published Free WAF
rate-limiting allowance is **one rule total**. The only current slot is
already occupied by leaked-credential protection. Do **not** replace or
disable that existing protection to make room for KiCad. To introduce
separate KiCad endpoint protection, first verify a supported plan/capacity
upgrade or an independently reviewed alternative that retains the
existing rule and equivalent security properties.

## Independently required endpoint protection

Before real pairing or outbound WebSocket activation, approve endpoint,
hostname and method-scoped **distributed edge request limits**:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/v1/pairing/device/challenge` | POST | Bound unauthenticated device issuance |
| `/api/v1/pairing/device/redeem` | POST | Bound brute-force and replay requests |
| `/api/v1/connector/ws` | GET | Bound WebSocket opening attempts |

The actual backend independently applies PostgreSQL rate budgets and
Ed25519 identity proof; the edge rule does **not** replace them.
A raw source IP is not device identity. Verify legitimate NAT/shared-IP
traffic, mobile clients, URL normalization, WSS Upgrade semantics,
rate-limit window and mitigation duration against the zone plan. Do not
copy synthetic threshold values into a live WAF rule without a load and
abuse review. Cloudflare's WAF may permit different characteristics and
durations on different subscription tiers.

## Offline fail-closed acceptance contract

The optional CLI accepts a **sanitized operator-prepared snapshot** from
stdin. It neither authenticates to Cloudflare nor creates any rule:

```bash
node --test scripts/test-cloudflare-edge.mjs
node scripts/check-cloudflare-edge.mjs < sanitized-cloudflare-state.json
```

Only explicitly approved, nonsensitive facts should be included:

- `zoneName: "oaslananka.dev"` and
  `hostname: "kicad-mcp-pro.oaslananka.dev"`; a proxied CNAME
  `dns` object with its Tunnel DNS target. Other zones/hostnames block.
- `tunnel`: ID, health, connection count, KiCad hostname/service mapping,
  and `otherHostnameCount` (not other projects' individual hostnames).
- `expectedDedicatedTunnelId`: a new, separately approved KiCad-specific
  Tunnel (never assume the current shared one qualifies).
- `rateLimiting`: observed plan, verified inventory status, active rules
  with action, expression, IP/datacenter characteristics, period and
  request rate; `capacityVerified` is necessary for non-Free plans.
- `workerRoutes`, `transformRules` inventory status and source-header
  rewrite counts; `originIsolationAccepted` and
  `headerProvenanceAccepted` backed by **separate live evidence**.

The output contains **finding codes only**, not input values. On a
missing, stale, malformed or inadequate inventory, the CLI must fail
closed. A `CONFIG_PREREQUISITES_MET` response means only that the
**syntactic inventory conditions** were met: it is NOT confirmation of
WAF ruleset expression semantics, Cloudflare plan entitlements, true
network isolation, real header authenticity, or authority to deploy.

The ruleset, DNS and Tunnel must be verified again immediately before
a rollout. Only approved operator changes should provision a dedicated
tunnel, edge rules and an isolated private origin; the shared Tunnel's
other three hostnames and leaked-credential rate rule must remain intact.

## Production gates retained

The existing origin topology fails its own read-only
`ingress:preflight`; the proposed candidate in
`infra/compose.isolated-ingress.candidate.yml` is **offline only**.
No production migrations 007–012, OAuth providers, WSS/device flags, or
physical KiCad acceptance are complete. An encrypted offsite backup and
actual full restore are separate prerequisites.

Primary Cloudflare references:

- https://developers.cloudflare.com/waf/rate-limiting-rules/
- https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/
- https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/
- https://developers.cloudflare.com/fundamentals/reference/http-headers/
