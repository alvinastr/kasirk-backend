# Production Deployment — Phase 6B.2

This repository ships a Docker Compose production configuration for a small Ubuntu 24.04 VPS.

## Architecture

- `postgres`: `postgres:16-alpine`, private Docker network only, no host port published.
- `app`: NestJS container, published only on `127.0.0.1:3000:3000`.
- `pgdata`: persistent named Docker volume for PostgreSQL data.
- Caddy/HTTPS is configured separately and should be the only public HTTP/HTTPS entry point.

## Required production environment file

Create `.env.production` on the VPS from `.env.production.example`. Do not commit it.

Required secret variables:

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET`

Required non-secret variables:

- `PORT=3000`
- `NODE_ENV=production`
- `ENABLE_SWAGGER_DOCS=false`

`DATABASE_URL` must point at the Compose service name `postgres` on the private Docker network.

## Migration procedure

Migrations are explicit. Normal app startup does not run migrations or seeds.

1. Start PostgreSQL:

```bash
docker compose up -d postgres
```

2. Wait for PostgreSQL health:

```bash
docker compose ps postgres
```

3. Rebuild app image after any Dockerfile change, then apply production migrations:

```bash
docker compose --env-file .env.production build app
docker compose --env-file .env.production run --rm app npx prisma migrate deploy
```

Prisma 7 CLI reads `datasource.url` from `/app/prisma.config.ts`, which the
runtime image includes alongside `prisma/schema.prisma` and migrations.
The config reads `DATABASE_URL` from container environment supplied by
Compose `env_file`; `dotenv/config` preserves an already-set environment value.
`.env.production` remains excluded from build context and image.
NestJS PrismaPg adapter config remains separate. Migration is an explicit step,
never app startup; CLI is bundled in image, without deployment-time download.

4. Start app:

```bash
docker compose up -d app
```

5. Verify health:

```bash
curl -fsS http://127.0.0.1:3000/
```

Expected response:

```json
{"status":"ok"}
```

Do not run seed commands in production.

## Exposure rules

- PostgreSQL port `5432` is not published to the host.
- App port `3000` is bound only to `127.0.0.1`.
- Swagger is disabled unless `ENABLE_SWAGGER_DOCS=true`; production keeps it `false`.
- Public ingress should come through Caddy after Caddy is configured.

## Resource settings

For a 1 vCPU / 1 GB RAM / 2 GB swap VPS:

- PostgreSQL memory limit: `256m`
- App memory limit: `448m`
- Node heap: `--max-old-space-size=384`
- PostgreSQL settings:
  - `shared_buffers=32MB`
  - `effective_cache_size=192MB`
  - `maintenance_work_mem=16MB`
  - `work_mem=2MB`
  - `max_connections=20`
- Prisma/pg pool max: `5` connections in `src/prisma/prisma.service.ts`

These values leave headroom for Docker, OS, swap pressure, and future Caddy.

## Graceful shutdown

NestJS shutdown hooks are enabled so Docker `SIGTERM` triggers lifecycle cleanup. `PrismaService` disconnects in `onModuleDestroy()`.

## Production bootstrap (initial business data setup)

**WARNING: One-time setup only. Run once on an EMPTY migrated production database.**

Once migrations are deployed, the production database is empty of business data. Run the bootstrap CLI to create:
- First tenant with `store_code` for Auth V2
- First outlet for the tenant
- First OWNER user with password/PIN login

### Prerequisites

- Production database schema/migrations applied via `npx prisma migrate deploy`
- No existing `tenants`, `users`, or `outlets` rows
- `.env.production` file present on VPS with all required secrets

### Execution

Run inside the app container (no public endpoint, CLI-only):

```bash
docker compose --env-file .env.production run --rm app sh -c "BOOTSTRAP_STORE_CODE='YOUR-CODE' \
  BOOTSTRAP_TENANT_NAME='Your Tenant Name' \
  BOOTSTRAP_OUTLET_NAME='Main Outlet' \
  BOOTSTRAP_OWNER_NAME='Initial Owner' \
  BOOTSTRAP_OWNER_EMAIL='admin@example.com' \
  BOOTSTRAP_OWNER_PASSWORD='**REDACTED**' \
  BOOTSTRAP_OWNER_PIN='123456' \
  npm run bootstrap:production"
```

### Safety behaviors

- Refuses if any `tenants`, `users`, or `outlets` rows already exist
- No upsert/update/delete — only CREATE in a single transaction
- Uses `Serializable` isolation to prevent concurrent empty-count races
- Never prints secrets, hashes, or `DATABASE_URL`
- Exit code `1` on failure/refusal, `0` on success

### Expected success output

```
Production bootstrap successful:
  Tenant ID:    <UUID>
  Store Code:   <STORE_CODE>
  Outlet ID:    <UUID>
  OWNER ID:     <UUID>
  OWNER Email:  <admin@example.com>
```

### Post-bootstrap verification

1. Test Auth V2 store resolve:

```bash
curl -fsS -X POST https://api.bekasirk.tech/auth/v2/store/resolve \
  -H 'Content-Type: application/json' \
  -d '{"store_code":"YOUR-CODE"}'
```

2. Test OWNER login (password):

```bash
curl -fsS -X POST https://api.bekasirk.tech/auth/v2/login/password \
  -H 'Content-Type: application/json' \
  -d '{"store_code":"YOUR-CODE","email":"admin@example.com","password":"**REDACTED**"}'
```

3. Test OWNER login (PIN):

```bash
curl -fsS -X POST https://api.bekasirk.tech/auth/v2/login/pin \
  -H 'Content-Type: application/json' \
  -d '{"store_code":"YOUR-CODE","email":"admin@example.com","pin":"123456"}'
```

Do not store any secrets in logs, scripts, or version control. Re-run `npm run bootstrap:production` will refuse — business data already exists.
