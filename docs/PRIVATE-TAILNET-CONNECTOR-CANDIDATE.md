# Owner-only private KiCad device transport — candidate, not live

## Why this path

For a single owner-operated KiCad workstation and Cloud host already joined
to the same private Tailscale network, a transient authenticated SSH forward
avoids introducing a public WebSocket route, a Cloudflare Worker, an extra
WAF rate-limit rule or any new paid service. It is **not** a substitute for
the longer-term public-device onboarding design, and is not usable by a
workstation outside this owner's tailnet.

## Verified on actual owner devices

Using an existing approved SSH identity over the tailnet, a one-shot **reverse
loopback-only** SSH forward from the Cloud host into the workstation reached
only the running Cloud container's internal HTTP listener. The temporary
forward was closed immediately after testing. Requests used the existing
canonical HTTPS production hostname as the `Host` value; no credentials,
project paths or device keys were supplied.

- `GET /health`: HTTP 200, matching the current Cloud revision
- `POST /api/v1/pairing/device/challenge`: HTTP 404 (feature OFF)
- `GET /api/v1/connector/ws`: HTTP 404 (feature OFF)

This proves private **network reachability and fail-closed default routing**,
not that a real KiCad device can already pair or receive tool requests.

## Opt-in trust policy in source

The default `cloudflare` mode and its exact trusted cloudflared peer / single
`CF-Connecting-IP` requirement are unchanged. In the future, an explicitly
configured `CONNECTOR_INGRESS_MODE=private_ssh` instead requires one
`TRUSTED_PRIVATE_SSH_PEER`, a canonical exact RFC1918 IPv4 address from the
owner-reviewed Docker host gateway. It does not trust any forwarded source or
claimed Tailscale identity header. A wrong TCP peer, absent/malformed address,
any claimed forwarding header, conflicting trust modes or unsupported mode
fails closed. Only one source rate-budget key exists for this owner-operated
private path; origin PostgreSQL device/fingerprint quotas and Ed25519 proofs
still apply. All values stay in operator-private configuration, not source.

**Security limit:** the application observes only the host-side Docker
bridge address, not the cryptographic SSH principal. The owner must first
prove that (1) only approved SSH/tailnet identities can establish the forward,
(2) the workstation bind is loopback-only, (3) the Cloud HTTP listener is NOT
published to the host/public Internet, (4) no untrusted host process can
inject requests through the pinned gateway, and (5) reconfiguration or
container addressing changes fail closed. Host-side processes are inside the
trusted owner-admin boundary. If that premise does not hold, do not activate
this mode. The presence of `private_ssh` in source proves none of these
runtime controls.

## Remaining acceptance, before production activation

1. Keep both device feature flags OFF until the private ingress's exact host
   peer and SSH permissions are independently recorded and accepted. Do not
   change existing Tailscale Serve mappings; they are used by other services.
2. In a disposable Cloud database/runtime, test issue → owner browser approve
   → one-use Ed25519 redeem → signed WebSocket challenge/session → revoke.
   Real owner approval is mandatory; knowing the pairing code is not enough.
3. Build the versioned read-only connector adapter in the local KiCad MCP Pro
   repository in a scoped task after this Cloud side is accepted. Keep file
   allowlists on the workstation, send only opaque project IDs to Cloud, and
   validate DRC/ERC against an owner-selected test project.
4. Never activate remote write/manufacturing execution or anonymous public
   device routes as a side effect of the private pilot. ChatGPT OAuth remains
   on the existing public Cloud hostname and uses independent project grants.
5. A permanent transport must have owner-operated restart/reconnect and
   revocation guarantees. A one-shot SSH command is a connectivity test, not
   a managed production daemon.

This is a narrow, cost-free alternative for an **existing paired tailnet**;
future untrusted public clients still require dedicated ingress and separate
edge DDoS/source-authentication acceptance.
