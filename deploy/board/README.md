# Kaneo board deployment

Single-host deployment of this fork behind the existing Caddy. It runs its own
PostgreSQL and never shares a database with `gge_bot`.

- Public URL: `https://board.sunsetproject.online`
- Compose project: `kaneo-board` in `/opt/kaneo-board`
- Container port: `127.0.0.1:5174` (loopback only; Caddy terminates TLS)
- Sign-in: panel IdP only, `https://auth.sunsetproject.online`

## 1. Build and pin the image

Build on the host from the exact commit you intend to release, then pin that
tag in `KANEO_IMAGE`. Do not deploy `latest`.

```sh
git clone https://github.com/ronydzedun/kaneo.git /opt/kaneo-src
cd /opt/kaneo-src && git checkout <commit>
docker build -f Dockerfile.kaneo -t kaneo-board:<commit> .
```

`.env`:

```sh
KANEO_IMAGE=kaneo-board:<commit>
```

## 2. Secrets

Each file is a single value, mode `0600`, owned by the deploying user.

```sh
install -d -m 0700 secrets
openssl rand -hex 32 > secrets/postgres_password
openssl rand -hex 32 > secrets/auth_secret
openssl rand -hex 48 > secrets/oidc_client_secret
openssl rand -hex 48 > secrets/sync_secret
chmod 600 secrets/*
```

`sync_secret` is shared only with the panel worker. `oidc_client_secret` is the
OIDC client secret issued by the IdP.

## 3. Register the OIDC client on the IdP

Add one client to the IdP registry (`provider.json` clients list) and restart
the IdP container. The panel's own two clients stay unchanged.

```json
{
  "client_id": "kaneo-board",
  "name": "Kaneo board",
  "redirect_uris": ["https://board.sunsetproject.online/api/auth/external-oidc/callback"],
  "post_logout_redirect_uris": ["https://board.sunsetproject.online/"],
  "grant_types": ["authorization_code", "refresh_token"],
  "scopes": ["openid", "profile"],
  "backchannel_logout_uri": "https://board.sunsetproject.online/api/auth/external-oidc/backchannel",
  "trusted_logout": true,
  "secret_hash": "<argon2 hash of secrets/oidc_client_secret>"
}
```

The IdP supports `openid profile`, PKCE S256 and back-channel logout. It does
not offer an `email` scope, which is why Kaneo never receives an address.

## 4. Start

```sh
cp .env.sample .env    # then edit
cp Caddyfile.example /etc/caddy/board.caddy
# add: import /etc/caddy/board.caddy   to /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
docker compose up -d
docker compose ps
docker compose logs --tail=50 kaneo
```

First start applies migrations to an empty database. The first native account
created becomes the instance administrator; register it once, then leave
`DISABLE_REGISTRATION=true` so only panel-provisioned accounts appear.

## 5. Panel synchronization

The panel pushes `{subject, name, revision, granted}` to
`POST /api/identity-sync` with `Authorization: Bearer <sync_secret>`.

- New subjects get a Kaneo user with no email and no access.
- `granted: true` gives a 60-second lease that the panel renews every ~20s.
- `granted: false` deletes sessions and closes sockets immediately.
- A missing renewal expires access; nothing else has to run.
- Workspace roles and project assignments are set in Kaneo and survive revokes.

`EXTERNAL_IDENTITY_ISSUER` must equal the IdP issuer; the endpoint refuses to
run without it and without a 32+ character secret.

## 6. Backup and restore

```sh
docker compose exec -T postgres pg_dump -U kaneo -d kaneo -Fc > kaneo-$(date +%F).dump
pg_restore --list kaneo-YYYY-MM-DD.dump | head
```

Restore into a fresh volume, never over a live one:

```sh
docker compose stop kaneo
docker compose exec -T postgres dropdb -U kaneo kaneo && \
  docker compose exec -T postgres createdb -U kaneo kaneo
docker compose exec -T postgres pg_restore -U kaneo -d kaneo < kaneo-YYYY-MM-DD.dump
docker compose up -d kaneo
```

Keep the panel SQLite backup next to it: access decisions live in both systems.

## 7. Rollback

The image tag is the rollback unit. Deployments are additive migrations, so an
older image keeps working after a newer one ran:

```sh
KANEO_IMAGE=kaneo-board:<previous-commit> docker compose up -d kaneo
```

If the database itself must move back, restore the dump from step 6 and start
the matching image. Panel-side state does not need restoring: the worker
reconciles from panel data on the next pass.

## 8. Verify after deploy

```sh
curl -fsS https://board.sunsetproject.online/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://board.sunsetproject.online/
```

Then, signed in as the administrator: create a workspace, assign it to a
provisioned account, and confirm the account can sign in and see only its
workspace. Revoke `board` in the panel and confirm the session ends within a
minute.
