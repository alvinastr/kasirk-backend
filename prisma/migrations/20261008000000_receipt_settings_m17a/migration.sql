BEGIN;

CREATE TABLE "receipt_settings" (
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "header_store_name" VARCHAR(100) NOT NULL,
    "header_outlet_name" VARCHAR(100) NOT NULL,
    "header_address" VARCHAR(500),
    "header_phone" VARCHAR(30),
    "header_additional_text" VARCHAR(500),
    "show_sku" BOOLEAN NOT NULL DEFAULT true,
    "show_modifiers" BOOLEAN NOT NULL DEFAULT true,
    "show_item_notes" BOOLEAN NOT NULL DEFAULT true,
    "show_cashier" BOOLEAN NOT NULL DEFAULT true,
    "show_customer" BOOLEAN NOT NULL DEFAULT true,
    "footer_thank_you_text" VARCHAR(200) NOT NULL DEFAULT 'Terima kasih',
    "footer_promo_text" VARCHAR(500),
    "template_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_settings_pkey" PRIMARY KEY ("tenant_id", "outlet_id"),
    CONSTRAINT "chk_receipt_settings_template_version" CHECK ("template_version" >= 1)
);

CREATE UNIQUE INDEX "uq_receipt_settings_outlet_tenant"
    ON "receipt_settings"("outlet_id", "tenant_id");

ALTER TABLE "receipt_settings"
    ADD CONSTRAINT "fk_receipt_settings_tenant"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "receipt_settings"
    ADD CONSTRAINT "fk_receipt_settings_outlet_same_tenant"
    FOREIGN KEY ("outlet_id", "tenant_id") REFERENCES "outlets"("id", "tenant_id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
