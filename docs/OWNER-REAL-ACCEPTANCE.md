# Cloud owner authorization: real-device acceptance gate

Status: **NO-GO** (29 October 2026). Scope: `oaslananka/kicad-mcp-pro-cloud`
draft PR #64 only. This is a **human/physical acceptance plan**, not proof
that the production connector is available, and not a request to turn it on.

## Verified evidence (do not substitute synthetic tests for human proof)

| Surface | Evidence | Accepted? |
| --- | --- | --- |
| Cloud production health | `/health` returns `status=ok`, production revision `9bfc760`, `remoteConnector=not_implemented` | Existing production only |
| Production login | `GET /sign-in` serves a real first-party GitHub login option; anonymous `/devices` redirects | Existing Cloud identity only |
| Independent owner passkey origin | Current Cloud `GET /owner-passkey/register` returns 404; no independent authority has been deployed | **NO** |
| Independent Better Auth session | Draft-only verifier and isolated HTTPS/PostgreSQL tests reject forged, expired, revoked and non-owner sessions | Synthetic only |
| Full approval chain | Chrome virtual passkey + four isolated PostgreSQL roles successfully register, activate, approve and consume once | Synthetic only |
| Local KiCad engine on a test workstation | KiCad CLI 10.0.7 loaded a disposable board; `pcb drc --format json` reported 0 violations / 0 unconnected items | Local CLI only |
| Cloud ↔ KiCad live remote read | No real device connection, physical owner confirmation or live `project_summary` round trip | **NO** |
| Separate daily offsite backup | `kicad-cloud-offsite.timer` not installed on VPS at last checked state | **NO** |

**Never interpret the local KiCad CLI check as Cloud-to-KiCad end-to-end
acceptance.** The only supported Cloud remote operation under review is
`project_summary` **presence flags**. Do not request or expose file contents,
DRC/ERC details, board edits or manufacturing operations.

## Required before a real-owner acceptance session

1. **Independent owner authority.** Choose and register a dedicated
   HTTPS origin and a separate GitHub/Google social OAuth application with
   an exact redirect URI for **that** origin. Do not reuse the Cloud public
   origin, Cloud Better Auth secret, Cloud login cookie or live OAuth
   client registration as a shortcut. Keep credentials in approved secret
   storage; do not place them in PRs, chat logs or shell output.
2. **Explicit separate server configuration.** Run the owner authority
   with its **own** identity database, session cookie, approved owner account,
   CSRF HMAC key and access-limited registration/activation/issuer database
   identities. No service is currently deployed; draft classes and test
   callbacks do not constitute a production-capable server.
3. **Independent enrollment and activation.** The actual owner signs in
   using the registered social provider and physically creates a passkey
   with user verification. Verify it is registered **inactive** and has
   issued zero project-read receipts. A separately authenticated authority
   explicitly approves activation, requiring a **fresh** passkey assertion.
   The registration SQL role cannot activate, and activation cannot issue
   a project-read receipt.
4. **Single approved scope.** Using the actual approved OAuth client and
   paired local KiCad device, display the exact owner, OAuth client,
   device, project, origin, `project_summary` and expiry. Obtain explicit
   physical passkey confirmation *for that particular request* and verify
   precisely one one-use receipt with exactly matching identities and
   deadline. Replaying or changing client, project, device, operation or
   origin must fail.
5. **Actual device round trip.** From the allowed private ingress, bring
   up a real authorized local KiCad connector on the test workstation and validate one
   metadata-only response through Cloud WSS. Kill/revoke the device and
   confirm no further read. An unmounted consent port or a disconnected
   client is a **denial**, not permission to bypass the gate.

## Negative tests that must pass with real independent identities

- Anonymous, expired, revoked, wrong-owner or unverified Better Auth session
  cannot load owner review or create a registration challenge.
- Browser Origin/Host/CSRF mismatch, misleading forwarded headers and
  caller-provided owner IDs do not authenticate.
- Unenrolled/inactive passkey cannot issue read approval; failed assertions
  consume their challenge and cannot be replayed.
- Approving one scope cannot authorize a different project, OAuth client,
  device, operation or expiration; consumed receipts cannot be re-armed.
- The connector remains deny-by-default with absent issuer, database role,
  device, trusted ingress, session or consent receipt; any failure preserves
  the existing production service.

## Release decision

**NO-GO until all required real-identity and physical-device proofs exist.**
The person performing acceptance must record date, exact tested Cloud SHA,
approved independent authority origin, device and project IDs **without
secrets**, test results and the evidence of explicit human presence.
Only then review #64 for ready-for-review and merge through normal
protected-branch checks. No automatic merge or `CONNECTOR_WS_ENABLED`
change follows from a passing *synthetic* test.

No production writes, DNS/OAuth app creation, support tickets, emails or
changes to another repository are authorized by this document.
