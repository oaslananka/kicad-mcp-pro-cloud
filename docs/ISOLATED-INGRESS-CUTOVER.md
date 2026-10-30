# KiCad Cloud — isolated ingress candidate and rollback (NOT deployed)

**Current stage (27 October 2026):** An existing, independently named
KiCad-only Cloudflare Tunnel has a remotely managed route staged for the KiCad
hostname and origin `http://app:8787`, with Host header fixed and 404 fallback.
The Tunnel is **inactive with zero connectors**, and production DNS continues
to target the original healthy shared Tunnel. No public traffic switched.
The production DB has separately reached schema **012**, but device API and WSS
are still OFF. The Free zone's only rate-limit rule remains occupied by an
unrelated leaked-credential guard. Isolation + edge protection remains BLOCKED.

**Scope:** this is a reviewed *candidate* overlay, not a production change.
Do not start containers or alter a Cloudflare hostname route by following the
validation instructions alone. The existing `ops-cloudflared` connector
serves unrelated applications and MUST NOT be stopped, recreated, retokenized,
disconnected or reconfigured as part of the KiCad change.

## Target security architecture

- Retain the existing `kicad-cloud` Compose project, single application
  image `kicad-mcp-pro-cloud:production`, unchanged persistent PostgreSQL 17
  database volume and internal database network.
- Replace the app's shared `ops_internal` attachment with
  `kicad_cloud_ingress_private`: an isolated, **internal**, non-attachable
  two-member bridge, with one reserved static address for the app and one for
  **only a new dedicated KiCad `cloudflared` connector**.
- Connect the dedicated connector to a second, dedicated **egress** bridge
  (`kicad_cloud_connector_egress`) for Cloudflare outbound traffic.
  Neither app nor DB joins this external egress bridge.
- Run the new connector under its own remotely-managed **KiCad-only Tunnel**
  with a separately provisioned token. Its ingress service target after
  acceptance is `http://app:8787`. Never reuse the shared Tunnel token:
  this could inherit other applications' ingress routes.
- The dedicated Tunnel token stays in the existing authorized Doppler
  config `kicad-mcp-pro/prd_cloud`. The Docker Compose implementation for
  the read-only connector requires a file-backed secret source. The
  operator must privately materialize the token into a restricted tmpfs
  runtime file, set `KICAD_TUNNEL_TOKEN_FILE` to that file's absolute path,
  and run Compose without exposing token contents in output, CLI arguments,
  Docker environment, images, source or PRs. The file must remain available
  for connector restarts. If the tmpfs file is lost on reboot, restore it
  from Doppler before starting the connector. Do not switch public DNS until
  restart/restore recovery has been demonstrated.
- Do **not** enable built-in OAuth, pairing HTTP, WebSocket or any schema
  migration as part of this network-only candidate. Live DB currently
  reports versions 001–006; the connector control plane needs 007–012 later.

This design passes only a **necessary** topology gate. Docker daemon
administrators, malicious co-resident host processes, separate Docker bridges
and Cloudflare Worker/Transform configurations must be governed separately.
Fixed container IP alone does not authenticate the real visitor.

## Offline merge and security verification — safe now

Only the following commands are acceptable for verifying the candidate
**without modifying production**:

```bash
node scripts/check-ingress-candidate.mjs
node --test scripts/test-ingress-candidate.mjs
npm run check
```

The offline Compose validator combines
`infra/compose.production.yml` and
`infra/compose.isolated-ingress.candidate.yml`, and invokes
`docker compose config --format json` with **synthetic values only**.
It explicitly validates that the legacy `ops_internal` attachment is
removed, not accidentally merged back by Compose. It also validates
service/network membership, reserved addresses, token file mounting,
preservation of the DB volume and continued disabled production features.
It does not build images, create networks, deploy, read Doppler or call
Cloudflare APIs.

The candidate depends on Docker Compose **2.24.4+** `!override` semantics
and `secrets.environment` support. Before any real cutover, the
operator must inventory all host Docker subnets and choose an unused,
nonoverlapping RFC1918 ingress subnet and two static addresses *inside* it.
Never copy the example address range from the synthetic tests blindly.

## Release prerequisites — not yet met

1. Record the old KiCad public hostname → shared-Tunnel route and
   confirm the old app URL/health/OAuth discovery and its private metadata
   behavior. Preserve its exact rollback definition. Do not change any
   other hostname or the shared tunnel's 404 fallback.
2. Create a separate KiCad-only remotely-managed Tunnel and approve its
   exact account, connector, token storage, expected hostname and ingress
   path. This is a Cloudflare account change and **is not performed** by
   this PR. Rotate secrets independently; never retrieve/share existing
   shared-Tunnel tokens.
3. Verify an authorized, independently restorable, encrypted offsite
   backup of the production DB, and a safe rollback plan for the
   **network-only** change. No new database migration is needed for
   this transition.
4. Review VPS firewall, Docker daemon access, effective Compose merging,
   network subnet reservation, token file permissions, no host ports,
   no other members on the KiCad private ingress bridge and no new
   reachable path from another app. Confirm running connector is restricted
   to this hostname's origin.
5. Review Cloudflare dashboard/API for per-path rate-limit entitlements and
   rules on device challenge, redeem and WSS upgrade; verify edge limits
   without blocking legitimate clients sharing NAT addresses.
   Confirm Worker/Transform/header provenance, including subrequests.
   At last read-only audit the KiCad-specific rate rules were **absent**,
   and transform-phase acceptance was **unverified**.
6. Preserve a maintenance/cutover window. A zero-downtime switch has
   **not** been proved: changing the app's network attachment or hostname
   route may interrupt existing live browser/OAuth traffic. Any temporary
   dual-homing to both networks is an explicit, short-lived maintenance
   state that **cannot** pass the final topology preflight.

## Protected deployment watcher after ingress cutover

Before the operator-approved network transition, configure the existing
production systemd deployment service with
`KICAD_CLOUD_PRODUCTION_INGRESS=isolated` and verify that the service
inherits it. The default remains `shared`; unknown values are rejected.
The protected main-CI-only watcher uses the same two Compose files on app
recreation and image rollback, validates their configuration before
building, and refuses the shared configuration if the live app already
uses the private ingress bridge. The separate tunnel connector is never
started by the watcher's app-only deployment command.

Do not select this mode, launch the overlay or migrate the app until
the existing dedicated tunnel credential, routing, edge safeguards,
recovery and private-network acceptance have passed. The running
production watcher script version must be updated safely BEFORE
any network cutover; changing a DRAFT PR does not change that script.

## Operator-reviewed cutover sequence (future ONLY)

The following steps describe required **outcomes**, not an executable
deployment script. Each requires an authorized maintenance action.

- **Prepare:** record running image ID, DB volume identity, Compose
  revision and app/tunnel health. Confirm shared tunnel route snapshot
  and tested recovery plan. Reserve private subnet after checking collisions.
  Stage the independent KiCad Tunnel/token with **no active production
  hostname reassignment**.
- **Transition:** change only the KiCad application's network attachments
  and create the dedicated KiCad connector. Existing shared tunnel stays
  running for all other apps. Coordinate the KiCad hostname route cutover
  with the app network transition; accept a brief KiCad-only outage if
  necessary rather than reconfiguring the shared tunnel unexpectedly.
  Do not deploy a second KiCad application image or a second database.
- **Verify:** use a verified, unique dedicated connector token and route,
  run `npm run ingress:preflight -- --app <actual-app> --proxy
  <dedicated-connector> --network kicad_cloud_ingress_private
  --expected-peer <approved-ip>` on the VPS; require
  `PREREQUISITES_MET`, then confirm HTTP/TLS, real WSS upgrade headers,
  first-party `/health`, OAuth discovery, anonymous access denial and
  client IP provenance. Check all existing unrelated hostnames independently.
  Rate limiting and Worker rules are separate required checks.
- **Accept:** only after post-cutover monitoring and documented approval
  should any future device/API feature activation even be considered.
  Network acceptance is **not** approval to enable OAuth, WSS, pairing,
  remote native KiCad tools or migration 007–012.

## Rollback triggers and order

Trigger rollback on wrong hostname route, missing or malformed
`CF-Connecting-IP`, inability to reach Cloudflare through the dedicated
connector, failing health/OAuth discovery, unknown Docker network member,
unexpected TLS/WSS errors, lost database access or any impact to other apps.

1. **Keep DB and application image untouched.** Do not restore or delete
   production DB in response to a network-only cutover fault.
2. Ensure the KiCad app is reachable from the **original shared Tunnel**
   via its prior, recorded network attachment **before** redirecting
   the public KiCad hostname back to the recorded old route. Coordinate
   this to minimize downtime; never route traffic to an unreachable origin.
3. Reconfirm old KiCad hostname health, OAuth discovery and denial checks.
   Verify unrelated apps on the shared tunnel are still healthy.
4. Stop only the **dedicated KiCad connector** once old KiCad routing has
   recovered; do not touch shared `ops-cloudflared`. Do not run network/image
   prune, or remove the production database or unrelated networks.
5. Document any temporary dual-homing or untrusted-header exposure, revoke
   the retired dedicated token if necessary, and rerun preflight: a rollback
   to the historical network should yield **BLOCKED**, which is expected.
6. Keep the device API and WSS feature flags **OFF** until an independently
   accepted, complete isolation plus edge-protection rollout succeeds.

This procedure is Cloud-scope documentation, not authorization to alter
the shared infrastructure of other projects.


## Verified Cloudflare control-plane blockers (2026-10-27)

The live KiCad hostname still targets a healthy shared, remotely managed
Tunnel with three unrelated hostnames; its DNS CNAME resolves to that
Tunnel. Cloudflare's Free Website zone has **one active leaked-credential
rate-limit rule** but no KiCad-specific device/WSS rule. Do not remove
the current rule or cut over the hostname without an independently
reviewed dedicated Tunnel, preserved rules and verified edge capacity.
See [Cloudflare edge acceptance](CLOUDFLARE-EDGE-ACCEPTANCE.md).
