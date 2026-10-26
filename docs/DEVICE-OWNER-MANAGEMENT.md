# Authenticated Cloud device management — revoke-only increment

**Status:** Code is present, but production built-in OAuth remains disabled.
There is no live Google/GitHub signup, no user-facing device enrollment
endpoint, and no native KiCad tool/command relay.

When the **built-in identity provider has been independently accepted** and
`AUTH_MODE=builtin` is explicitly enabled, an authenticated first-party
browser session can access `GET /devices` to list **at most 100** of its
own *previously enrolled* device records. Device aliases are HTML-escaped.
The display deliberately avoids claiming that an enabled device is online.
No local paths, KiCad files, private device keys or signed proof frames
are included.

`POST /devices/revoke` accepts exactly two URL-encoded fields:
`device_id` and a per-session/device/short-lived signed CSRF proof.
A matching first-party `Origin`, HttpOnly SameSite=Strict state cookie,
authenticated Better Auth session and ownership checks are required.
Unknown/foreign IDs are both 404. No unauthenticated or cross-origin
mutation is exposed.

The revocation transaction takes owner-scoped device/credential locks
and in one PostgreSQL transaction: irreversibly timestamps key
revocation, disables the device, invalidates pending and active connector
sessions and handshake challenges, disables related projects and
their per-client grants. Revoked credentials cannot authenticate even
if a separate administrator incorrectly toggles a device flag.

The pairing core continues to reuse this exact revocation transaction,
so the browser and protocol do not diverge. No account can enable a
device, create projects, register keys or grant AI access using the new
browser page.

**Release gates still open:** registered production OAuth providers and
verified callbacks, managed pairing/consent UX, per-user/device rate limits,
production DB migration and offsite restore, connector TLS acceptance,
actual client pairing and cross-boundary cancellation. The page and tests
do not authorize deployment or local repo changes.
