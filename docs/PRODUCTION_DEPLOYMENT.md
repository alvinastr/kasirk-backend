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
