-- Generated with Prisma migrate diff, then extended for existing-row backfill
-- and CHECK constraints (not representable in schema.prisma).
-- Invalid legacy references/amounts fail the migration; no data is deleted or repaired silently.
BEGIN;

-- Keep ownership stable while validating and backfilling. Schedule a maintenance window.
LOCK TABLE "outlets", "users", "products", "transactions", "transaction_items", "payments"
IN SHARE ROW EXCLUSIVE MODE;

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "fk_payments_transaction";

-- DropForeignKey
ALTER TABLE "transaction_items" DROP CONSTRAINT "fk_transaction_items_product";

-- DropForeignKey
ALTER TABLE "transaction_items" DROP CONSTRAINT "fk_transaction_items_transaction";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "fk_transactions_outlet";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "fk_transactions_user";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "tenant_id" UUID,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "transaction_items" ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "tenant_id" UUID;

-- Derive ownership from the existing parent; never assign a default tenant.
UPDATE "payments" AS p
SET "tenant_id" = t."tenant_id", "updated_at" = p."created_at"
FROM "transactions" AS t WHERE p."transaction_id" = t."id";

UPDATE "transaction_items" AS i
SET "tenant_id" = t."tenant_id", "created_at" = t."created_at"
FROM "transactions" AS t WHERE i."transaction_id" = t."id";

ALTER TABLE "payments" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "transaction_items" ALTER COLUMN "tenant_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "uq_outlets_id_tenant" ON "outlets"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "idx_payments_tenant_status" ON "payments"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_products_id_tenant" ON "products"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "idx_transaction_items_tenant_transaction" ON "transaction_items"("tenant_id", "transaction_id");

-- CreateIndex
CREATE INDEX "idx_transactions_tenant_created_at" ON "transactions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_transactions_tenant_status" ON "transactions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_transactions_id_tenant" ON "transactions"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_id_tenant" ON "users"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_transaction_same_tenant" FOREIGN KEY ("transaction_id", "tenant_id") REFERENCES "transactions"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "fk_transaction_items_product_same_tenant" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "fk_transaction_items_transaction_same_tenant" FOREIGN KEY ("transaction_id", "tenant_id") REFERENCES "transactions"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "fk_transaction_items_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_outlet_same_tenant" FOREIGN KEY ("outlet_id", "tenant_id") REFERENCES "outlets"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_user_same_tenant" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Cast to numeric for validation so intermediate arithmetic cannot overflow BIGINT.
ALTER TABLE "transactions" ADD CONSTRAINT "chk_transactions_total_formula"
CHECK ("total"::numeric = "subtotal"::numeric + "tax"::numeric - "discount"::numeric);

ALTER TABLE "transaction_items" ADD CONSTRAINT "chk_transaction_items_subtotal_formula"
CHECK ("subtotal"::numeric = "quantity"::numeric * "unit_price"::numeric);

COMMIT;
