# Transaction database migrations

These files are generated and tested; they have **not been applied to the project database**.

## Migration history

- `20260914000000_baseline`: existing Prisma schema plus all 22 CHECK constraints read from the database. The database had no `_prisma_migrations` table. A read-only Prisma diff against the original schema was empty. There were no custom triggers.
- `20260914000100_transaction_tenant_integrity`: adds/backfills required child tenant IDs, enforces same-tenant foreign keys, adds item/payment timestamps and tenant indexes, and checks item/header arithmetic. The entire migration is transactional.

Existing money fields remain BIGINT. The unique `(tenant_id, client_transaction_id)` key and deletion behavior are preserved. Master tables only gain `(id, tenant_id)` unique keys needed by transaction relations. Stock tables and application controllers/services are unchanged.

## Status compatibility

Keep the verified existing database values:

- transactions: `PENDING`, `COMPLETED`, `CANCELLED`, `VOID`
- payments: `PENDING`, `PAID`, `FAILED`, `CANCELLED`
- payment methods: `CASH`, `QRIS`

The latest PROJECT_STATUS examples use transaction `PAID` and payment `SUCCESS`; these are **not** accepted database values. Resolve the API naming discrepancy before implementing checkout. No existing statuses are rewritten by these migrations.

## Applying later to an existing database

1. Back up the target database. Verify it matches the baseline, including CHECK constraints, and that it has no incompatible migration history. Do not execute the baseline CREATE TABLE statements against existing tables.
2. Review existing transaction ownership and totals. Invalid legacy references or arithmetic cause the second migration to fail and roll back. Resolve such rows through an explicit business decision; this migration does not silently alter money or delete records.
3. Once verified, mark the baseline as applied:

   ```sh
   npx prisma migrate resolve --applied 20260914000000_baseline
   ```

4. During a maintenance window, apply the pending migration:

   ```sh
   npx prisma migrate deploy
   npx prisma generate
   ```

The second migration takes table locks on outlets, users, products and transaction tables. Coordinate writes/deployment accordingly. These commands are documentation only; no baseline resolution or deployment was performed by this task.

For an empty database, `prisma migrate deploy` applies both migrations normally; do not mark the baseline applied.

## Data and ORM behavior

- Child `tenant_id` comes from the existing parent transaction, then becomes NOT NULL.
- Item `created_at` is backfilled from the parent; payment `updated_at` is initialized from its own `created_at`.
- `@updatedAt` updates transaction/payment timestamps through Prisma. Raw SQL writers must explicitly set `updated_at`; no database trigger is installed.
- Row-level arithmetic checks use numeric casts to avoid intermediate BIGINT overflow. Aggregate equality between a header and all its items/payments still belongs in the future atomic checkout service.
- Composite foreign keys enforce ownership consistency, not read authorization. Future queries must still filter on JWT tenant context; no RLS policy is added.
- Prisma schema diff/db push cannot reproduce custom CHECK constraints. Use these migrations for database creation and validation.

## Verification

Use a disposable PostgreSQL database, supplied explicitly (never the application DATABASE_URL):

```sh
MIGRATION_TEST_DATABASE_URL=postgresql://USER@localhost:PORT/DATABASE node --test prisma/tests/transaction-migration.test.cjs
```

Each test creates and removes its own randomly named schema. Tests cover clean installation, populated migration, backfill, cross-tenant rejection, money/status constraints, idempotency scope, and atomic failure on invalid legacy data.
