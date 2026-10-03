-- V1-M1: Database Foundation for Store Operations
-- Adds modifier configuration, transaction modifier snapshots, payment CASH fields,
-- transaction item product snapshots, transaction-shift association, and shift reconciliation flexibility.
-- This migration is additive and backward-compatible with all existing RC2 data.

-- ============================================================
-- A. ModifierGroup: tenant-owned reusable modifier groups
-- ============================================================

CREATE TABLE modifier_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_modifier_groups_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE RESTRICT,
    
    CONSTRAINT uq_modifier_groups_tenant_name
        UNIQUE (tenant_id, name),
    
    CONSTRAINT uq_modifier_groups_id_tenant
        UNIQUE (id, tenant_id)
);

CREATE INDEX idx_modifier_groups_tenant_id ON modifier_groups(tenant_id);

COMMENT ON TABLE modifier_groups IS 'V1-M1: Tenant-owned reusable modifier groups. Selection rules live on product association.';

-- ============================================================
-- B. ModifierOption: tenant-owned modifier options with price delta
-- ============================================================

CREATE TABLE modifier_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    modifier_group_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    price_delta INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_modifier_options_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE RESTRICT,
    
    CONSTRAINT fk_modifier_options_modifier_group_same_tenant
        FOREIGN KEY (modifier_group_id, tenant_id)
        REFERENCES modifier_groups(id, tenant_id)
        ON DELETE RESTRICT,
    
    CONSTRAINT uq_modifier_options_tenant_group_name
        UNIQUE (tenant_id, modifier_group_id, name),
    
    CONSTRAINT chk_modifier_options_price_delta_non_negative
        CHECK (price_delta >= 0)
);

CREATE INDEX idx_modifier_options_tenant_id ON modifier_options(tenant_id);
CREATE INDEX idx_modifier_options_group_tenant ON modifier_options(modifier_group_id, tenant_id);

COMMENT ON TABLE modifier_options IS 'V1-M1: Tenant-owned modifier options. price_delta is integer Rupiah, must be >= 0.';
COMMENT ON COLUMN modifier_options.price_delta IS 'Integer Rupiah added to product base price when selected.';

-- ============================================================
-- C. ProductModifierGroup: product-specific modifier association
-- ============================================================

CREATE TABLE product_modifier_groups (
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL,
    modifier_group_id UUID NOT NULL,
    required BOOLEAN NOT NULL DEFAULT false,
    selection_type VARCHAR(20) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    
    PRIMARY KEY (tenant_id, product_id, modifier_group_id),
    
    CONSTRAINT fk_product_modifier_groups_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE RESTRICT,
    
    CONSTRAINT fk_product_modifier_groups_product_same_tenant
        FOREIGN KEY (product_id, tenant_id)
        REFERENCES products(id, tenant_id)
        ON DELETE RESTRICT,
    
    CONSTRAINT fk_product_modifier_groups_group_same_tenant
        FOREIGN KEY (modifier_group_id, tenant_id)
        REFERENCES modifier_groups(id, tenant_id)
        ON DELETE RESTRICT,
    
    CONSTRAINT chk_product_modifier_groups_selection_type
        CHECK (selection_type IN ('SINGLE', 'MULTIPLE'))
);

CREATE INDEX idx_product_modifier_groups_tenant_id ON product_modifier_groups(tenant_id);
CREATE INDEX idx_product_modifier_groups_product_tenant ON product_modifier_groups(product_id, tenant_id);
CREATE INDEX idx_product_modifier_groups_group_tenant ON product_modifier_groups(modifier_group_id, tenant_id);

COMMENT ON TABLE product_modifier_groups IS 'V1-M1: Product <-> ModifierGroup association with product-specific selection rules.';
COMMENT ON COLUMN product_modifier_groups.selection_type IS 'SINGLE or MULTIPLE selection mode for this product-group pair.';

-- ============================================================
-- D. TransactionItemModifier: immutable modifier snapshot
-- ============================================================

CREATE TABLE transaction_item_modifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    transaction_id UUID NOT NULL,
    transaction_item_id UUID NOT NULL,
    modifier_group_id UUID,
    modifier_option_id UUID,
    group_name_snapshot VARCHAR(150) NOT NULL,
    option_name_snapshot VARCHAR(150) NOT NULL,
    price_delta_snapshot INTEGER NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_transaction_item_modifiers_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE RESTRICT,
    
    CONSTRAINT fk_transaction_item_modifiers_transaction_same_tenant
        FOREIGN KEY (transaction_id, tenant_id)
        REFERENCES transactions(id, tenant_id)
        ON DELETE CASCADE,
    
    CONSTRAINT fk_transaction_item_modifiers_item_same_tenant
        FOREIGN KEY (transaction_item_id, tenant_id)
        REFERENCES transaction_items(id, tenant_id)
        ON DELETE CASCADE,
    
    CONSTRAINT chk_transaction_item_modifiers_price_delta_non_negative
        CHECK (price_delta_snapshot >= 0)
);

CREATE INDEX idx_transaction_item_modifiers_tenant_transaction ON transaction_item_modifiers(tenant_id, transaction_id);
CREATE INDEX idx_transaction_item_modifiers_tenant_item ON transaction_item_modifiers(tenant_id, transaction_item_id);

COMMENT ON TABLE transaction_item_modifiers IS 'V1-M1: Immutable transaction item modifier snapshots. Snapshot text/price is authoritative; master IDs are nullable provenance only.';
COMMENT ON COLUMN transaction_item_modifiers.modifier_group_id IS 'Nullable provenance reference to master modifier group.';
COMMENT ON COLUMN transaction_item_modifiers.modifier_option_id IS 'Nullable provenance reference to master modifier option.';

-- ============================================================
-- E. Transaction-CashierSession association
-- ============================================================

ALTER TABLE transactions
ADD COLUMN cashier_session_id UUID;

ALTER TABLE transactions
ADD CONSTRAINT fk_transactions_cashier_session_same_tenant
    FOREIGN KEY (cashier_session_id, tenant_id)
    REFERENCES cashier_sessions(id, tenant_id)
    ON DELETE RESTRICT;

CREATE INDEX idx_transactions_tenant_cashier_session ON transactions(tenant_id, cashier_session_id);

COMMENT ON COLUMN transactions.cashier_session_id IS 'V1-M1: Nullable reference to shift. Legacy transactions remain valid with NULL. Future V1 API requires this for new transactions.';

-- ============================================================
-- F. Payment CASH fields
-- ============================================================

ALTER TABLE payments
ADD COLUMN amount_received BIGINT,
ADD COLUMN change_amount BIGINT;

ALTER TABLE payments
ADD CONSTRAINT chk_payments_amount_received_non_negative
    CHECK (amount_received IS NULL OR amount_received >= 0);

ALTER TABLE payments
ADD CONSTRAINT chk_payments_change_amount_non_negative
    CHECK (change_amount IS NULL OR change_amount >= 0);

COMMENT ON COLUMN payments.amount_received IS 'V1-M1: CASH tender amount received. NULL for legacy rows and non-CASH methods.';
COMMENT ON COLUMN payments.change_amount IS 'V1-M1: CASH change returned. NULL for legacy rows and non-CASH methods.';

-- ============================================================
-- G. Transaction item product snapshots
-- ============================================================

ALTER TABLE transaction_items
ADD COLUMN product_name_snapshot VARCHAR(150),
ADD COLUMN sku_snapshot VARCHAR(100),
ADD COLUMN base_price_snapshot BIGINT,
ADD COLUMN effective_price_snapshot BIGINT;

-- Add composite unique constraint required for transaction_item_modifiers FK
ALTER TABLE transaction_items
ADD CONSTRAINT uq_transaction_items_id_tenant UNIQUE (id, tenant_id);

COMMENT ON COLUMN transaction_items.product_name_snapshot IS 'V1-M1: Immutable product name at transaction time. NULL for legacy rows.';
COMMENT ON COLUMN transaction_items.sku_snapshot IS 'V1-M1: Immutable product SKU at transaction time. NULL for legacy rows.';
COMMENT ON COLUMN transaction_items.base_price_snapshot IS 'V1-M1: Product base price before modifiers. NULL for legacy rows.';
COMMENT ON COLUMN transaction_items.effective_price_snapshot IS 'V1-M1: Effective price including modifier deltas. NULL for legacy rows.';

-- ============================================================
-- H. Shift reconciliation flexibility
-- ============================================================

ALTER TABLE cashier_sessions
ALTER COLUMN opening_cash DROP NOT NULL;

COMMENT ON COLUMN cashier_sessions.opening_cash IS 'V1-M1: Now nullable. Legacy shifts retain values. Future V1 shifts may open without cash counting.';

-- ============================================================
-- Migration metadata
-- ============================================================

COMMENT ON SCHEMA public IS 'V1-M1 migration applied: modifier configuration, transaction modifier snapshots, payment CASH fields, transaction item product snapshots, transaction-shift association, flexible shift reconciliation.';
