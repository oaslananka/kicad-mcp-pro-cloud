# Cloudflare Tunnel trusted client source — release gate, NOT active

Cloud-only code support; no release or infrastructure modification.

Cloudflare's current published documentation says an HTTP Tunnel origin sees
the `cloudflared` peer, not the real client TCP address, and carries the
client IP in `CF-Connecting-IP`. **That header is not self-authenticating.**
It can be forged over a direct/internal HTTP connection, and a Cloudflare
Worker can influence IP headers in some subrequest configurations.

Docs:
- https://developers.cloudflare.com/cloudflare-one/networks/connectivity-options/
- https://developers.cloudflare.com/fundamentals/reference/http-headers/

## Fail-closed source contract

If either `PAIRING_DEVICE_API_ENABLED=true` or
`CONNECTOR_WS_ENABLED=true`, the Cloud process now also **requires**
`TRUSTED_CLOUDFLARED_PEERS`: a deliberately operator-reviewed,
comma-separated list of **exact** TCP peer IPs (maximum eight). Missing,
malformed, wildcard or CIDR values prevent server startup. This option is
not placed in the production compose file and remains unset by default.

For an enabled device HTTP or WebSocket request, the source resolver:

1. Verifies the observed TCP peer is an exact, configured trusted proxy.
2. Requires exactly one `CF-Connecting-IP` header on the incoming wire;
   missing, duplicate, comma-chained, invalid or unspecified addresses fail.
3. Normalizes IPv6 and IPv4-mapped IPv6 to canonical IP strings, so equivalent
   spellings do not split PostgreSQL rate-limit keys.
4. Does **not** use untrusted `X-Forwarded-For`, `Forwarded`,
   `X-Real-IP`, client-provided token/owner IDs, or the tunnel peer IP as
   a fallback. Source failure blocks pairing issuance/redemption and
   WebSocket Upgrade before issuing a device challenge.

The address is only an **abuse-rate budget key**, never authorization.
Actual credential enrollment still requires human owner approval and
one-use Ed25519 proof. WebSocket session activation independently requires
device signatures; no KiCad remote command dispatcher is exposed.

## Production prerequisites — not fulfilled by code merge

- Confirm exact running `cloudflared` container/origin TCP peer address,
  stability across restart and redeploy, isolated Docker network, and no
  bypass path for other processes to inject forged origin headers.
  A general-purpose shared network or an entire Docker subnet must not
  be marked trusted just to make the feature work.
- Confirm the Cloudflare zone/hostname routes are exclusively under
  controlled Tunnel configuration; review Worker routing, Transform Rules,
  header rewriting, TLS, WebSocket Upgrade and Cloudflare Access policy.
  Do not accept Worker-modifiable source claims without separate acceptance.
- Apply independent, **distributed edge rate limits** to device challenges,
  redemption, and WebSocket upgrade attempts. Origin per-source budgets
  cannot replace edge DDoS protection or device credential policy.
- Ensure automatic tunnel/container address changes fail closed rather
  than silently trusting another container's new IP.
- Only after the above, independently verify migration ledger 007–012,
  safe backup/restore, real OAuth and native device interoperability.
  Production is currently `AUTH_MODE=external`; feature flags OFF and
  pairing database tables absent.

No proxy/container addresses or sensitive operational network layout are
committed here; discover them through authorized read-only Ops inspection.
