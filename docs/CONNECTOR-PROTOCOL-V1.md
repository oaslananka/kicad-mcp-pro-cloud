# Cloud ↔ local connector transport contract — proposed v1 slice

Status: **schema and validation tests only** (2026-10-26). This is an early,
read-only wire envelope contract. No pairing, relay endpoint, device credential,
heartbeat, execution, or deployed connector is implemented in this change.

## Separate from MCP

ChatGPT/Claude speak OAuth-protected MCP 2026-07-28 with Cloud at `/mcp`.
The proposed outbound connector uses its own versioned messages between an
authenticated local agent and Cloud. This is **not** an MCP `initialize` or
`Mcp-Session-Id` flow. MCP 2026-07-28 is stateless; device identity, enrollment,
project selection and authorization must be separately enforced.

## Intended user flow

1. User installs the existing KiCad MCP Pro desktop application, keeps account-free
   local MCP available, and explicitly chooses **Connect Cloud**.
2. Local application requests short-lived, single-use pairing. Cloud presents a
   code for the user to approve in their authenticated browser session; the code
   alone must **never** authorize a new device.
3. After browser approval, Cloud and local agent prove possession of their
   matching pairing challenge through an authenticated, outbound TLS channel.
   Cloud binds a revocable, device-specific credential to that owner.
4. Local user selects KiCad projects via a local folder chooser. Local agent
   validates canonical paths/symlinks and stores them locally; Cloud receives
   only opaque `projectId`, `deviceId`, aliases, status and policy metadata.
5. A client with a verified OAuth identity and explicit project/client grant
   requests a read-only task. Cloud authenticates the connected device, checks
   the current grant and routes a bounded, expiring, project-explicit envelope.
   The local engine re-checks its project allowlist and mode.
6. Disabling a project, revoking a client/device or disconnecting a device
   prevents new execution. No queued writes or execution retries while offline.

The pairing handshake, credential rotation, revocation and reconnect algorithms
remain **design requirements**, not implemented or accepted endpoints.

## Envelopes compiled into the Cloud package

`src/connector-protocol.ts` currently parses only:

- `connector.hello`: `version:1`, device UUID, instance UUID, bounded engine
  version, and a unique subset of `project_summary`, `run_drc`, `run_erc`.
- `connector.read_request`: `version:1`, request UUID, device UUID, project
  UUID, one of those read operations and absolute `deadlineUnixMs` (maximum
  30 seconds into the future, expiry is inclusive).

Unknown fields are rejected. Native paths, free-form tool names, arbitrary
payloads and authentication secrets cannot be smuggled into either envelope.
UUIDs are opaque handles, not authorization tokens.

The hello parser compares the claimed device UUID to an already-authenticated
device principal. The read parser separately compares its claims to a **trusted**
current project/device/operation boundary. Callers must source that boundary
from live OAuth/client grants + device authentication, never from the frame.
Parsing is not sufficient to issue authorization. This code is deliberately
not wired into any live HTTP or MCP route.

## Unimplemented security and acceptance gates

- Single-use browser/device pairing with short TTL, bounded attempts, anti-CSRF,
  authenticated owner confirmation, credential issuance and revocation.
- Actual persistent outbound TLS transport, independently authenticated device,
  heartbeat TTL, disconnect/reconnect and bounded frame size.
- User/client/project policy intersection, local symlink/path verification,
  per-project scheduling and no-execution-on-revocation tests.
- Cancellation, duplicate/replayed request ID handling, crash and deadline
  handling, request/result payload constraints and safe redaction.
- Physical KiCad DRC/ERC execution, real ChatGPT/Claude host pairing and
  privacy/latency evidence. Do not announce the connector usable before these.

Keep this protocol small and versioned alongside real client acceptance; no
second tool-catalog implementation. Prefer testing the simulator and local
engine adapter before enabling any privileged Cloud endpoint.
