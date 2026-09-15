BEGIN;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(30),
    "email" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "customer_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "uq_customers_tenant_phone" ON "customers"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customers_id_tenant" ON "customers"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "idx_customers_tenant_id" ON "customers"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_transactions_tenant_customer_created_at" ON "transactions"("tenant_id", "customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "fk_customers_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_customer_same_tenant" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
