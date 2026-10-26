# Infrastructure-as-code adoption gate

We now produce a secret-free OCI application image, but production destination,
network policy, Cloudflare DNS ownership, PostgreSQL backup/restore, auth
registrations, and deployment credentials are not yet verified. This directory
therefore contains no unreviewed OpenTofu provider or resource definitions.

When the destination is verified, use a minimal, reviewed OpenTofu module in
this repository. Pin provider and OpenTofu versions; separate state per
environment; review plan before apply. Never fetch app secrets into OpenTofu
state or pass them through outputs, plan, or cloud-init. Provision only concrete
infrastructure (HTTPS routing, firewall, persistent DB and DNS if appropriate).
Do not replace working equivalent services merely for consistency.

Build the image without secrets. At runtime inject Doppler configuration through
a controlled secret bootstrap. Docker environment variables can be retrieved by
privileged Docker operators; do not assume container inspect is a secret vault.
Do not copy Doppler downloads to repository files or image layers.

Production release needs real login + consent flows, MCP clients, database
restore drill, digest-pinned image deploy and tested rollback. None are proven
by this image build.
