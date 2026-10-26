# Security metadata retention — opt-in, bounded maintenance

This code adds **no scheduled task**, no Docker daemon/cron service, no
production deployment and no automatic database mutation. Existing production
feature flags and OAuth/WebSocket settings remain unchanged.

The operator must inject an authorized `DATABASE_URL` and first run
`npm run db:prune -- --dry-run`. To explicitly request one small batch
of deletion, run `npm run db:prune -- --apply` with the same reviewed
database and a verified backup/recovery plan.

Each invocation is bounded to **at most 100 rows per table** in one
transaction. Tables are processed in dependency-safe order:

1. Connector sessions whose hard expiry is **more than 30 days old**.
2. Device handshake challenges older than 30 days, **only if no
   connector session refers to them**.
3. Pairing challenges older than 30 days, **only if no enrolled device
   credential refers to them**, even if their state is `consumed`.
4. Owner review budgets whose five-minute window began more than 24 hours
   ago.
5. Device issuance/redemption budgets whose 15-minute window began more
   than 24 hours ago.

The database clock (`statement_timestamp()`) controls retention. No
connection is accepted merely because a row was retained: all relevant
authentication and expiration checks remain independent and fail closed.
The retention client cannot set a shorter grace period or unbounded
batch size via environment or CLI options.

`--dry-run` runs in a PostgreSQL read-only transaction and reports
eligible rows **capped at 100** plus an indication of more records.
`--apply` uses `FOR UPDATE SKIP LOCKED`, a two-second lock timeout and a
ten-second statement timeout. A failed transaction rolls back. It never
deletes devices, credentials, OAuth records, project grants, audit trails
outside these five tables, or KiCad data. It does not change live
session or challenge state just to make records eligible.

Two simultaneous maintenance clients may each process a batch; aggregate
throughput remains bounded per invocation rather than through a global
worker lock. Do not run multiple workers concurrently in production
without a separately reviewed operations plan. The command reports
**counts, not sensitive IDs, codes, client IPs or database URLs**.
The separate physical KiCad application repository is out of scope.

For rollout: verify migration history, role privileges, backup and
restore tests, connection saturation, and exact live retention needs.
A future maintenance schedule, if desired, requires an explicit
operational decision and protection against overlapping runs; this
change does **not** install one.
