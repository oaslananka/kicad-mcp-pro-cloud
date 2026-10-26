# Connector transport object binding (not a live endpoint)

This slice attaches the existing PostgreSQL handshake and per-client/read
admission helpers to a **server-owned connection object identity**. The
object is a future outbound TLS/WebSocket connection handle, not a
client-supplied session ID, string, cookie, header or URL parameter.

`BoundConnectorConnections` reserves the object immediately, preventing
double open; tracks the issued nonce, server-generated binding and session;
verifies the device signature; and accepts signed read preflights only for
the same still-active object, matching owner. Disconnect fences the object
immediately and tries to close the PostgreSQL session; an in-flight issue
that returns after disconnect burns its newly issued handshake. Reads that
complete after a disconnect are dropped.

This is an in-memory, non-networked bridge. It does **not** prove device
authentication on actual outbound TLS, websocket upgrade security, verified
OAuth bearer/PKCE/session, client provenance or local KiCad runtime
allowlist. It cannot authorize execution: even accepted read preflight
must be rechecked when entering the actual local engine. There is no
HTTP/WebSocket route and no production change.

Future transport MUST pass a real trusted WebSocket object key, independently
authenticate the local device before `begin`, and supply OAuth claims only
from verified JWT middleware. Never construct or look up sockets from
untrusted request identity strings. Document and test disconnect, replays,
TLS channel security, origin, IP rate limits and heartbeat before enabling.
