-- CreateTable
CREATE TABLE "held_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "origin_cashier_session_id" UUID NOT NULL,
    "cashier_user_id" UUID NOT NULL,
    "label" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "subtotal_estimate" BIGINT NOT NULL DEFAULT 0,
    "tax_estimate" BIGINT NOT NULL DEFAULT 0,
    "total_estimate" BIGINT NOT NULL DEFAULT 0,
    "converted_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(6),
    "converted_at" TIMESTAMPTZ(6),

    CONSTRAINT "held_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_held_orders_status" CHECK ("status" IN ('OPEN', 'CONVERTED', 'CANCELLED')),
    CONSTRAINT "chk_held_orders_version_positive" CHECK ("version" >= 1),
    CONSTRAINT "chk_held_orders_terminal_timestamps" CHECK (
        ("status" = 'OPEN' AND "cancelled_at" IS NULL AND "converted_at" IS NULL AND "converted_transaction_id" IS NULL)
        OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "converted_at" IS NULL AND "converted_transaction_id" IS NULL)
        OR ("status" = 'CONVERTED' AND "converted_at" IS NOT NULL AND "converted_transaction_id" IS NOT NULL AND "cancelled_at" IS NULL)
    ),
    CONSTRAINT "chk_held_orders_estimates_non_negative" CHECK ("subtotal_estimate" >= 0 AND "tax_estimate" >= 0 AND "total_estimate" >= 0),
    CONSTRAINT "chk_held_orders_estimates_consistent" CHECK ("total_estimate" = "subtotal_estimate" + "tax_estimate")
);

-- CreateTable
CREATE TABLE "held_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "held_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "product_name_snapshot" VARCHAR(150) NOT NULL,
    "sku_snapshot" VARCHAR(100) NOT NULL,
    "base_price_snapshot" BIGINT NOT NULL,
    "effective_price_snapshot" BIGINT NOT NULL,
    "line_subtotal" BIGINT NOT NULL,
    "line_discount" BIGINT NOT NULL DEFAULT 0,
    "line_total" BIGINT NOT NULL,
    "note_snapshot" VARCHAR(255),
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "held_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_held_order_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "chk_held_order_items_amounts_non_negative" CHECK (
        "base_price_snapshot" >= 0 AND "effective_price_snapshot" >= 0
        AND "line_subtotal" >= 0 AND "line_discount" >= 0 AND "line_total" >= 0
    ),
    CONSTRAINT "chk_held_order_items_line_consistent" CHECK (
        "line_total" = "line_subtotal" - "line_discount" AND "line_discount" <= "line_subtotal"
    ),
    CONSTRAINT "chk_held_order_items_display_order_non_negative" CHECK ("display_order" >= 0)
);

-- CreateTable
CREATE TABLE "held_order_item_modifiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "held_order_item_id" UUID NOT NULL,
    "modifier_group_id" UUID,
    "modifier_option_id" UUID,
    "group_name_snapshot" VARCHAR(150) NOT NULL,
    "option_name_snapshot" VARCHAR(150) NOT NULL,
    "price_delta_snapshot" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "held_order_item_modifiers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_held_order_item_modifiers_price_delta_non_negative" CHECK ("price_delta_snapshot" >= 0)
);

-- CreateIndex
CREATE INDEX "idx_held_orders_tenant_id" ON "held_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_held_orders_tenant_outlet" ON "held_orders"("tenant_id", "outlet_id");

-- CreateIndex
CREATE INDEX "idx_held_orders_tenant_session" ON "held_orders"("tenant_id", "origin_cashier_session_id");

-- CreateIndex
CREATE INDEX "idx_held_orders_tenant_cashier" ON "held_orders"("tenant_id", "cashier_user_id");

-- CreateIndex
CREATE INDEX "idx_held_orders_tenant_status" ON "held_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_held_orders_tenant_created_at" ON "held_orders"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_held_orders_id_tenant" ON "held_orders"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "idx_held_order_items_tenant_order" ON "held_order_items"("tenant_id", "held_order_id");

-- CreateIndex
CREATE INDEX "idx_held_order_items_product_id" ON "held_order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_held_order_items_id_tenant" ON "held_order_items"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "idx_held_order_item_modifiers_tenant_item" ON "held_order_item_modifiers"("tenant_id", "held_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_held_order_item_modifiers_id_tenant" ON "held_order_item_modifiers"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "held_orders" ADD CONSTRAINT "fk_held_orders_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "held_orders" ADD CONSTRAINT "fk_held_orders_outlet_same_tenant" FOREIGN KEY ("outlet_id", "tenant_id") REFERENCES "outlets"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "held_orders" ADD CONSTRAINT "fk_held_orders_cashier_session_same_tenant" FOREIGN KEY ("origin_cashier_session_id", "tenant_id") REFERENCES "cashier_sessions"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "held_orders" ADD CONSTRAINT "fk_held_orders_user_same_tenant" FOREIGN KEY ("cashier_user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "held_orders" ADD CONSTRAINT "fk_held_orders_converted_transaction_same_tenant" FOREIGN KEY ("converted_transaction_id", "tenant_id") REFERENCES "transactions"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "held_order_items" ADD CONSTRAINT "fk_held_order_items_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "held_order_items" ADD CONSTRAINT "fk_held_order_items_order_same_tenant" FOREIGN KEY ("held_order_id", "tenant_id") REFERENCES "held_orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "held_order_items" ADD CONSTRAINT "fk_held_order_items_product_same_tenant" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "held_order_item_modifiers" ADD CONSTRAINT "fk_held_order_item_modifiers_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "held_order_item_modifiers" ADD CONSTRAINT "fk_held_order_item_modifiers_item_same_tenant" FOREIGN KEY ("held_order_item_id", "tenant_id") REFERENCES "held_order_items"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;
