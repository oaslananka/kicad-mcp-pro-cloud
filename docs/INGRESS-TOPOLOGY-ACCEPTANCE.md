# Cloud ingress isolation — deployment preflight (read-only)

**Status: Source-code acceptance test only. No Docker/Cloudflare production
configuration is changed, and no application feature flag is enabled.**

The existing Cloudflare Tunnel origin must be treated as untrusted until
the real tunnel TCP peer identity is fixed, the HTTP source headers are
authenticated by a private ingress path, and independent Cloudflare edge
rate limits are verified. The origin's TCP socket is **not** the visitor IP.

## Why a static allowlist alone is insufficient

On the last live, read-only inspection, the application and the
shared tunnel connector both joined a multi-tenant Docker bridge with
six members and no explicit per-service static IP assignment. Simply
copying the connector's current IP into
`TRUSTED_CLOUDFLARED_PEERS` is not a safe deployment. Other workloads
on that bridge may reach the origin directly, and a future container
replacement may change the address. No production flag is authorized
by the existence of this verification tool.

A future *dedicated ingress link* requires an isolated, internal,
non-attachable Docker bridge shared **only** by the app and its
approved tunnel connector. Both must have stable explicit endpoint
addresses, and the app must not publish a host port or attach to
another non-private network. Other app networks must be internal
(e.g. a dedicated database network). The tunnel connector must still
have separate outbound egress to reach Cloudflare.

The tunnel routing, container isolation and network change must be
planned together, with a verified rollback to the known-good Cloud
metadata/OAuth service. Do **not** move or disrupt the existing
shared tunnel (which serves other applications) as an incidental
side effect of enabling KiCad pairing.

## Bounded read-only operator command

Build first and run only on the authorized VPS host (not inside the
production app container):

```bash
npm run build
npm run ingress:preflight -- \
  --app <cloud-app-container> \
  --proxy <dedicated-cloudflared-container> \
  --network <private-ingress-bridge> \
  --expected-peer <static-proxy-ip-address>
```

The operator provides exact container/network names and the expected
already-reviewed proxy address; the command never invents or trusts a
default. It uses only Docker **inspect** operations, does not mutate
containers, and outputs a JSON verdict with short nonsensitive finding
codes. A failed requirement exits nonzero. It never outputs tokens,
Cloudflare ingress config, cookies or device key material.

The offline verifier checks the isolated private network has only the
two expected container IDs, both endpoint IPs are explicitly pinned,
the trusted peer matches the pinned proxy address, and the app has no
published port, privileged mode, added capabilities or nonprivate
network attachment. These are **necessary but not sufficient**
conditions: a positive preflight does not attest Cloudflare zone
configuration, origin firewall, OS-level Docker admin, TLS,
Worker/Transform source header integrity, or deployed rate limits.

## Separate mandatory edge and rollout gates

- Confirm the Cloudflare zone/hostname uses the intended Tunnel route,
  no Worker or Transform rule can inject attacker-controlled source
  headers into the trusted origin path, and direct-origin bypass is
  blocked and tested.
- Set independent WAF rate limits on exact device
  `/api/v1/pairing/device/challenge` and
  `/api/v1/pairing/device/redeem` POST routes; separately bound the
  HTTP-to-WebSocket handshake endpoint. Use edge source address +
  hostname/path to group, with thresholds validated against legitimate
  NAT/shared-network traffic. Do not claim the origin's DB rate budgets
  replace distributed edge abuse controls.
- Verify live WebSocket Upgrade headers (including
  `CF-Connecting-IP`), mobile clients and failure behavior through
  the Tunnel and check IPv4/IPv6 normalization.
- Back up and restore-test the production database before applying
  migrations 007–012. Built-in OAuth and device enrollment are not
  production accepted, and physical local KiCad tests require separate
  repository authorization.

See Cloudflare documentation:
- https://developers.cloudflare.com/cloudflare-one/networks/connectivity-options/
- https://developers.cloudflare.com/fundamentals/reference/http-headers/
- https://developers.cloudflare.com/waf/rate-limiting-rules/

## Latest read-only acceptance evidence (2026-10-27)

- The currently deployed application/tunnel network fails this preflight:
  shared non-internal bridge, extra members, and missing static endpoint
  IPAM configuration. This is an **expected BLOCKED result**, not an
  instruction to reconfigure a live shared tunnel.
- Read-only zone inspection showed **no KiCad-specific edge rate limit**
  at the zone rate-limiting entrypoint. The observed active rule covered
  leaked credentials, not device challenge/redeem or WSS upgrades.
- No Worker Routes were present at the zone route endpoint. Transform-phase
  entrypoints were unavailable/not present to the read-only query, so a
  complete source-header provenance acceptance **cannot be claimed**.
- No running live Cloud feature flag, Docker network, Cloudflare rule or
  production database setting was changed during this verification.

The operator must re-run current live checks at rollout; time-bound
inspection is evidence, not a standing clearance.
