BEGIN;

CREATE TABLE "cashier_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "opening_cash" BIGINT NOT NULL,
    "closing_cash" BIGINT,
    "expected_cash" BIGINT,
    "difference" BIGINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "cashier_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_cashier_sessions_status" CHECK ("status" IN ('OPEN', 'CLOSED')),
    CONSTRAINT "chk_cashier_sessions_opening_cash" CHECK ("opening_cash" >= 0),
    CONSTRAINT "chk_cashier_sessions_closing_cash" CHECK ("closing_cash" IS NULL OR "closing_cash" >= 0),
    CONSTRAINT "chk_cashier_sessions_state" CHECK (
        (
            "status" = 'OPEN'
            AND "closing_cash" IS NULL
            AND "expected_cash" IS NULL
            AND "difference" IS NULL
            AND "closed_at" IS NULL
        )
        OR
        (
            "status" = 'CLOSED'
            AND "closing_cash" IS NOT NULL
            AND "expected_cash" IS NOT NULL
            AND "difference" IS NOT NULL
            AND "closed_at" IS NOT NULL
        )
    ),
    CONSTRAINT "uq_cashier_sessions_id_tenant" UNIQUE ("id", "tenant_id")
);

CREATE INDEX "idx_cashier_sessions_tenant_id"
ON "cashier_sessions"("tenant_id");

CREATE INDEX "idx_cashier_sessions_tenant_user_status"
ON "cashier_sessions"("tenant_id", "user_id", "status");

CREATE INDEX "idx_cashier_sessions_tenant_outlet_opened_at"
ON "cashier_sessions"("tenant_id", "outlet_id", "opened_at");

CREATE UNIQUE INDEX "uq_cashier_sessions_open_user"
ON "cashier_sessions"("tenant_id", "user_id")
WHERE "status" = 'OPEN';

ALTER TABLE "cashier_sessions"
ADD CONSTRAINT "fk_cashier_sessions_tenant"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "cashier_sessions"
ADD CONSTRAINT "fk_cashier_sessions_outlet_same_tenant"
FOREIGN KEY ("outlet_id", "tenant_id") REFERENCES "outlets"("id", "tenant_id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "cashier_sessions"
ADD CONSTRAINT "fk_cashier_sessions_user_same_tenant"
FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
