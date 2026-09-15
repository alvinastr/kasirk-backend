-- Baseline of the existing schema, including CHECK constraints verified read-only.
-- Existing databases: verify schema then mark this baseline applied; do not execute CREATE TABLE.
BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "amount" BIGINT NOT NULL,
    "provider" VARCHAR(50),
    "provider_reference" VARCHAR(255),
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outlet_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "minimum_stock" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "address" TEXT,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "subtotal" BIGINT NOT NULL,

    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_transaction_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "tax" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_categories_tenant_id" ON "categories"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_categories_tenant_name" ON "categories"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "idx_outlets_tenant_id" ON "outlets"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_payments_transaction_id" ON "payments"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_product_stocks_product_id" ON "product_stocks"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_stocks_outlet_product" ON "product_stocks"("outlet_id", "product_id");

-- CreateIndex
CREATE INDEX "idx_products_category_id" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "idx_products_tenant_id" ON "products"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_products_tenant_sku" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "idx_stock_adjustments_created_at" ON "stock_adjustments"("created_at");

-- CreateIndex
CREATE INDEX "idx_stock_adjustments_outlet_id" ON "stock_adjustments"("outlet_id");

-- CreateIndex
CREATE INDEX "idx_stock_adjustments_product_id" ON "stock_adjustments"("product_id");

-- CreateIndex
CREATE INDEX "idx_transaction_items_product_id" ON "transaction_items"("product_id");

-- CreateIndex
CREATE INDEX "idx_transaction_items_transaction_id" ON "transaction_items"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_transactions_outlet_created_at" ON "transactions"("outlet_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_transactions_outlet_id" ON "transactions"("outlet_id");

-- CreateIndex
CREATE INDEX "idx_transactions_tenant_id" ON "transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_transactions_user_id" ON "transactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_transactions_client_id" ON "transactions"("tenant_id", "client_transaction_id");

-- CreateIndex
CREATE INDEX "idx_users_tenant_id" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_tenant_email" ON "users"("tenant_id", "email");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "fk_categories_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "fk_outlets_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_transaction" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_stocks" ADD CONSTRAINT "fk_product_stocks_outlet" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_stocks" ADD CONSTRAINT "fk_product_stocks_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "fk_products_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "fk_products_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "fk_stock_adjustments_outlet" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "fk_stock_adjustments_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "fk_stock_adjustments_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "fk_stock_adjustments_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_outlet" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "fk_transaction_items_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "fk_transaction_items_transaction" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_outlet" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "fk_users_outlet" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "fk_users_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_amount" CHECK (((amount)::numeric > (0)::numeric));

ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_method" CHECK (((method)::text = ANY ((ARRAY['CASH'::character varying, 'QRIS'::character varying])::text[])));

ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_status" CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PAID'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying])::text[])));

ALTER TABLE "product_stocks" ADD CONSTRAINT "chk_product_stocks_stock" CHECK ((stock >= 0));

ALTER TABLE "products" ADD CONSTRAINT "chk_products_cost" CHECK (((cost)::numeric >= (0)::numeric));

ALTER TABLE "products" ADD CONSTRAINT "chk_products_minimum_stock" CHECK ((minimum_stock >= 0));

ALTER TABLE "products" ADD CONSTRAINT "chk_products_price" CHECK (((price)::numeric >= (0)::numeric));

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_quantity" CHECK ((quantity > 0));

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_type" CHECK (((type)::text = ANY ((ARRAY['ADD'::character varying, 'DEDUCT'::character varying])::text[])));

ALTER TABLE "stock_movements" ADD CONSTRAINT "chk_stock_movements_quantity" CHECK ((quantity <> 0));

ALTER TABLE "stock_movements" ADD CONSTRAINT "chk_stock_movements_type" CHECK (((type)::text = ANY ((ARRAY['SALE'::character varying, 'PURCHASE'::character varying, 'ADJUSTMENT'::character varying, 'RETURN'::character varying, 'VOID'::character varying])::text[])));

ALTER TABLE "tenants" ADD CONSTRAINT "chk_tenants_tax_rate" CHECK (((tax_rate >= (0)::numeric) AND (tax_rate <= (100)::numeric)));

ALTER TABLE "transaction_items" ADD CONSTRAINT "chk_transaction_items_quantity" CHECK ((quantity > 0));

ALTER TABLE "transaction_items" ADD CONSTRAINT "chk_transaction_items_subtotal" CHECK (((subtotal)::numeric >= (0)::numeric));

ALTER TABLE "transaction_items" ADD CONSTRAINT "chk_transaction_items_unit_cost" CHECK (((unit_cost)::numeric >= (0)::numeric));

ALTER TABLE "transaction_items" ADD CONSTRAINT "chk_transaction_items_unit_price" CHECK (((unit_price)::numeric >= (0)::numeric));

ALTER TABLE "transactions" ADD CONSTRAINT "chk_transactions_discount" CHECK (((discount)::numeric >= (0)::numeric));

ALTER TABLE "transactions" ADD CONSTRAINT "chk_transactions_status" CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying, 'VOID'::character varying])::text[])));

ALTER TABLE "transactions" ADD CONSTRAINT "chk_transactions_subtotal" CHECK (((subtotal)::numeric >= (0)::numeric));

ALTER TABLE "transactions" ADD CONSTRAINT "chk_transactions_tax" CHECK (((tax)::numeric >= (0)::numeric));

ALTER TABLE "transactions" ADD CONSTRAINT "chk_transactions_total" CHECK (((total)::numeric >= (0)::numeric));

ALTER TABLE "users" ADD CONSTRAINT "chk_users_role" CHECK (((role)::text = ANY ((ARRAY['OWNER'::character varying, 'ADMIN'::character varying, 'CASHIER'::character varying])::text[])));

COMMIT;
