BEGIN;

-- Auth V2 is introduced additively. Existing tenants remain valid until a
-- separately reviewed backfill assigns their stable store codes.
ALTER TABLE "tenants"
ADD COLUMN "store_code" VARCHAR(32);

ALTER TABLE "users"
ADD COLUMN "locked_until" TIMESTAMPTZ(6),
ADD COLUMN "login_code" VARCHAR(50),
ADD COLUMN "pin_changed_at" TIMESTAMPTZ(6),
ADD COLUMN "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pin_hash" TEXT,
ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "device_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "device_name" VARCHAR(100),
    "refresh_token_hash" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "rotated_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_device_sessions_status"
        CHECK ("status" IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT "chk_device_sessions_revocation_state"
        CHECK (
            ("status" = 'ACTIVE' AND "revoked_at" IS NULL)
            OR
            ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL)
        ),
    CONSTRAINT "chk_device_sessions_expiry"
        CHECK ("expires_at" > "created_at")
);

CREATE TABLE "auth_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "session_id" UUID,
    "event" VARCHAR(100) NOT NULL,
    "result" VARCHAR(30) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tenants"
ADD CONSTRAINT "chk_tenants_store_code_format"
CHECK (
    "store_code" IS NULL
    OR "store_code" ~ '^[A-Z0-9-]{3,32}$'
);

ALTER TABLE "users"
ADD CONSTRAINT "chk_users_pin_failed_attempts"
CHECK ("pin_failed_attempts" >= 0);

CREATE INDEX "idx_device_sessions_tenant_user_status"
ON "device_sessions"("tenant_id", "user_id", "status");

CREATE INDEX "idx_device_sessions_tenant_user_device"
ON "device_sessions"("tenant_id", "user_id", "device_id");

CREATE INDEX "idx_device_sessions_expires_at"
ON "device_sessions"("expires_at");

CREATE UNIQUE INDEX "uq_device_sessions_id_tenant"
ON "device_sessions"("id", "tenant_id");

CREATE INDEX "idx_auth_audit_logs_tenant_created_at"
ON "auth_audit_logs"("tenant_id", "created_at");

CREATE INDEX "idx_auth_audit_logs_tenant_user_created_at"
ON "auth_audit_logs"("tenant_id", "user_id", "created_at");

CREATE INDEX "idx_auth_audit_logs_tenant_session"
ON "auth_audit_logs"("tenant_id", "session_id");

CREATE INDEX "idx_auth_audit_logs_tenant_event_created_at"
ON "auth_audit_logs"("tenant_id", "event", "created_at");

-- PostgreSQL permits multiple NULL values in a unique index. This lets the
-- additive migration succeed before store-code and login-code backfills.
CREATE UNIQUE INDEX "uq_tenants_store_code"
ON "tenants"("store_code");

CREATE UNIQUE INDEX "uq_users_tenant_login_code"
ON "users"("tenant_id", "login_code");

ALTER TABLE "device_sessions"
ADD CONSTRAINT "fk_device_sessions_tenant"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "device_sessions"
ADD CONSTRAINT "fk_device_sessions_user_same_tenant"
FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "auth_audit_logs"
ADD CONSTRAINT "fk_auth_audit_logs_tenant"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "auth_audit_logs"
ADD CONSTRAINT "fk_auth_audit_logs_user_same_tenant"
FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "auth_audit_logs"
ADD CONSTRAINT "fk_auth_audit_logs_session_same_tenant"
FOREIGN KEY ("session_id", "tenant_id") REFERENCES "device_sessions"("id", "tenant_id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
