# Portable, Doppler-first Cloud deployment

**Scope:** one fresh, owner-controlled Linux VPS and one configured HTTPS
hostname; existing production remains intact. A green test/CI run means this
installer is source-validated, **not** that an arbitrary new VPS, provider
registration or DNS cutover has been independently accepted.

## Contract and secrets boundary

- Doppler is the canonical source of **static** runtime settings and secrets.
  No `.env`, extra GitHub Actions secrets, GitHub Variables or secret-containing
  OCI build arguments are needed. User sessions, OAuth grants and dynamic
  signing keys/metadata still live in encrypted/controlled PostgreSQL state.
- The only user-created GitHub repository secret is `DOPPLER_TOKEN`: a **read-only,
  production-config-scoped service token**. `Production Deployment` now uses it
  to resolve `PUBLIC_ORIGIN` for live acceptance; manual config validation also
  uses it. Never authorize it on PR code or print its contents.
- Every VPS requires its **own** read-only Doppler service token as a bootstrap
  credential, registered via the official CLI at the deployment worktree's
  filesystem scope. The VPS cannot obtain a token merely because GitHub has
  one; GitHub Actions has no VPS admin/SSH access. A scoped token is itself a
  bootstrap credential stored by the Doppler CLI, not inside the app's Doppler
  secrets or in Git. Prefer separate, independently revocable GitHub/VPS tokens
  to the same production config. In directory-scoped mode, an inherited
  `DOPPLER_TOKEN`, `DOPPLER_PROJECT` or `DOPPLER_CONFIG` could override the
  directory selection: the wrapper explicitly refuses these combinations. See official Doppler
  service-token docs.
- Domain, OAuth issuer/JWKS/audience, PostgreSQL password, GitHub/Google OAuth
  client credentials, Better Auth root secret, management identity, allowed
  origins and dedicated Docker ingress network name are set in Doppler.
- The **source GitHub repository and deploy workflow logic** remain fixed by
  design: deployments from other repos or untested pull requests are rejected.

### Required Doppler keys (new VPS, GitHub-only login)

| Name | Meaning |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact HTTPS origin, no trailing slash or path |
| `OAUTH_ISSUER` | `PUBLIC_ORIGIN` + `/api/auth` |
| `OAUTH_JWKS_URL` | `PUBLIC_ORIGIN` + `/api/auth/jwks` |
| `OAUTH_AUDIENCE` | `PUBLIC_ORIGIN` + `/mcp` |
| `KICAD_DB_PASSWORD` | Fresh production PostgreSQL password |
| `AUTH_MODE` | `builtin` for validated GitHub-only first launch |
| `BETTER_AUTH_SECRET` | Independent strong random auth root secret |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | New domain's GitHub OAuth app credentials |
| `KICAD_TUNNEL_NETWORK` | Dedicated Docker bridge name for this VPS, e.g. `kicad_private_ingress` |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token for a **dedicated, remotely managed** Cloudflare Tunnel |

Optional when explicitly configured: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `MANAGEMENT_CLIENT_ID`, `ALLOWED_ORIGINS` and backup
age keys. When both Google credentials are present, production smoke checks
that the Google login option is displayed; no credential value is logged. Provider pairs must be complete; OAuth providers need their own
registered callback URLs for the **new** domain. `PAIRING_DEVICE_API_ENABLED`
and `CONNECTOR_WS_ENABLED` must stay **false** until separate device-ingress
security acceptance. The portability bootstrap rejects them if enabled.

`DATABASE_URL` is intentionally composed inside Compose from the dedicated
container's fixed service hostname and database name, using the Doppler-provided
`KICAD_DB_PASSWORD` through `PGPASSWORD`; this avoids duplicating a credential
in a connection URL. Static internal Docker service names need not match your
public hostname.

## One-time external preparation (not automatic account mutations)

1. Control the target VPS (Linux/systemd, Docker Engine + Compose, Git, Node 24,
   Doppler CLI and outbound HTTPS). Install and harden them using trusted official
   distribution instructions. The installer does not run unattended sudo,
   cloud provisioning, package-manager bootstrap or provider API writes.
2. Create a fresh Doppler project/config for this deployment and fill the keys
   above. Register the same **config's separate scoped token** as GitHub's sole
   user-created secret, `DOPPLER_TOKEN`. Protect the `production` GitHub
   environment; validate token/config alignment before merging changes to main.
3. Create a dedicated Cloudflare Tunnel and set its public hostname to the new
   domain, pointing to `http://kicad-cloud-app-1:8787` on the dedicated Docker
   ingress network. Configure the hostname's DNS mapping in Cloudflare and
   verify HTTPS/Host and OAuth redirect endpoints. No Worker or paid WAF rule
   is required for the **disabled-device** baseline. A managed tunnel token
   grants control of that tunnel; keep it private in Doppler.
4. Register an OAuth application at GitHub with the correct callback URL:
   `https://YOUR_DOMAIN/api/auth/callback/github`. Update/rotate the provider
   credential pairs in Doppler; changing `PUBLIC_ORIGIN` alone **does not**
   update the external provider registration or the DNS/Tunnel route.
5. Clone `oaslananka/kicad-mcp-pro-cloud` from reviewed `main` into a fresh
   **dedicated, clean deployment worktree** (not a shared active development
   checkout). From that directory, run
   `bash scripts/setup-vps-doppler.sh YOUR_DOPPLER_PROJECT YOUR_DOPPLER_CONFIG`.
   It securely prompts for a read-only, config-scoped VPS service token on a
   TTY, uses `doppler setup --no-interactive --scope` for this exact directory,
   and checks configuration without printing values. Do not include the token
   in command arguments, shell history or plaintext files. Set the **nonsecret
   bootstrap selector** `KICAD_DOPPLER_SCOPED=true` in the installer shell.

## New-server execution (explicit, safe by default)

From the clean deployment worktree with the scoped Doppler credential:

```bash
export KICAD_DOPPLER_SCOPED=true
bash scripts/bootstrap-production-vps.sh preflight
# Only after the owner has prepared DNS, provider callback and a fresh VPS:
bash scripts/bootstrap-production-vps.sh install
```

`preflight` makes no deployment/network/database changes. It validates the
source identity, clean checked-out `origin/main`, Docker/Compose access,
Doppler values without printing secrets, disabled connector flags, and both
Compose files. It rejects a shared `ops_internal` ingress, existing KiCad app
or database containers, an existing name-colliding ingress network and
missing Cloudflare token. This is intentionally **not** a migration or upgrade
command for an already deployed VPS.

`install` explicitly creates only the named dedicated Docker ingress bridge,
builds the reviewed source, starts a *fresh* PostgreSQL database, runs the
checksummed schema migration in that fresh DB, starts the app and isolated
`cloudflared` container, waits a bounded time for the expected public HTTPS
revision, then validates OAuth/MCP read-only routes. It deliberately **does not**
enable the CI-gated user timer: two VPS watchers polling one `main` branch
could otherwise deploy in parallel without an approved cutover. On a failed first installation,
stop and inspect the partial resources; do not blindly rerun against the
existing database or purge shared Docker resources. Offsite backup scheduling,
first live OAuth owner approval, authorized release-watcher cutover, domain transfer, physical KiCad device pairing
and any paid provider change remain **separate acceptance tasks**.

### Release-watcher cutover (separate operator action)

After an independent installation acceptance, first disable the prior VPS's
`kicad-cloud-production.timer` under its owning `systemd --user` instance,
verify that it stopped, and verify the new destination is the one configured
by both the GitHub and VPS production Doppler tokens. Only then, from the new
clean deployment worktree, enable the existing timer by running
`KICAD_DOPPLER_SCOPED=true bash scripts/install-production-deploy-timer.sh`.
Do not run old and new production watchers concurrently; the repository has
one `main` release stream and one GitHub `DOPPLER_TOKEN` deployment destination.
This cutover is **not** an automated side effect of fresh installation.

On an **existing** production VPS, keep its existing shared Tunnel and Compose
network (`ops_internal` legacy default), release timer and Doppler selection.
Do **not** run the first-install workflow or create a second `cloudflared`
instance. For normal application releases, `main` CI gates the outbound-only
VPS deployment timer and GitHub independently checks the exact production
revision at the `PUBLIC_ORIGIN` it reads from the same Doppler config.

## Backups and configuration changes (operator-controlled)

For manual encrypted offsite backup/restore on a configured deployment,
provide `OFFSITE_REMOTE_SSH` and `OFFSITE_REMOTE_DIR` in the **source VPS's
Doppler config**, not in a new `.env` file, and execute
`bash scripts/doppler-runtime.sh bash scripts/offsite-backup-push.sh` from the
reviewed deployment worktree. The independent restore machine must already
have its own authorized age decryption identity from Doppler, plus reviewed
SSH access; optional `OFFSITE_RESTORE_DOPPLER_PROJECT` and
`OFFSITE_RESTORE_DOPPLER_CONFIG` select that independent machine's Doppler
configuration. Existing backups remain encrypted end to end and are never
implicitly copied during application installation. The legacy offsite
scheduled job uses a separate owner-private endpoint config file and is **not**
part of this new-server installation; its installation was not approved and
must not be silently enabled or worked around.

Doppler is a *configuration source*, not a magic live reconfiguration engine:
existing PostgreSQL passwords are not rotated merely by changing
`KICAD_DB_PASSWORD` (Postgres bootstrap initialization reads it only for a
fresh volume); `BETTER_AUTH_SECRET` must not be casually replaced because
existing encrypted signing/provider data may become unreadable. OAuth client
secret rotation requires updating the provider, and public domain changes
require DNS, Tunnel and registered callback URL changes. Recreate only the
appropriate service after reviewing config/secret rotation and recovery;
never invoke the fresh-VPS installer against existing production data.

## Acceptance before saying portable deployment is done

- Run offline fixture checks and CI; no real Doppler data appears in logs.
- Prove one **independently provisioned disposable VPS** end to end: scoped
  Doppler token, fresh schema, dedicated ingress, live OAuth callback, public
  smoke, no public app/DB ports, CI-gated next commit and app rollback.
- Restore an encrypted database snapshot into a second clean host and confirm
  the data/recovery policy for the chosen deployment. A fresh installation
  does not imply automated offsite backup scheduling.
- Confirm that changing only Doppler + external DNS/OAuth provider settings
  suffices for **another** VPS/domain without editing source code. Record
  recovery/rollback evidence before claiming deployment portability accepted.

Official documentation: https://docs.doppler.com/docs/service-tokens ;
https://developers.cloudflare.com/tunnel/get-started/ ;
https://docs.docker.com/reference/compose-file/networks/ .
