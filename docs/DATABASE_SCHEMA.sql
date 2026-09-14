-- ============================================================
-- KasirKita POS
-- DATABASE_SCHEMA.sql
-- PostgreSQL schema for ERD Final V1
-- ============================================================
--
-- Design principles:
--   - Multi-tenant
--   - Stock is per outlet
--   - Integer IDR amounts (no floating point money)
--   - Stock movement is the audit ledger
--   - Stock adjustment records the user's manual action
--   - Offline transactions use client_transaction_id
--   - Cross-tenant references are protected by composite FKs
--
-- NOTE:
-- This schema is a baseline migration/schema for V1.
-- Application-level transaction handling is still required for
-- sale + payment + stock updates to be atomic.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
    'OWNER',
    'ADMIN',
    'CASHIER'
);

CREATE TYPE transaction_status AS ENUM (
    'PENDING',
    'COMPLETED',
    'CANCELLED',
    'VOID'
);

CREATE TYPE payment_method AS ENUM (
    'CASH',
    'QRIS',
    'E_WALLET'
);

CREATE TYPE payment_status AS ENUM (
    'PENDING',
    'PAID',
    'FAILED',
    'EXPIRED',
    'CANCELLED'
);

CREATE TYPE stock_movement_type AS ENUM (
    'SALE',
    'PURCHASE',
    'ADJUSTMENT',
    'RETURN',
    'VOID'
);

CREATE TYPE stock_adjustment_type AS ENUM (
    'ADD',
    'DEDUCT'
);

-- ============================================================
-- TENANTS
-- ============================================================

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    address TEXT,
    tax_rate INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_tenants_tax_rate
        CHECK (tax_rate >= 0 AND tax_rate <= 100)
);

-- ============================================================
-- OUTLETS
-- ============================================================

CREATE TABLE outlets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_outlets_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_outlets_id_tenant
        UNIQUE (id, tenant_id),

    CONSTRAINT uq_outlets_tenant_name
        UNIQUE (tenant_id, name)
);

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    outlet_id UUID NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_users_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_users_outlet_same_tenant
        FOREIGN KEY (outlet_id, tenant_id)
        REFERENCES outlets(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_users_id_tenant
        UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX uq_users_email_lower
    ON users (LOWER(email));

-- ============================================================
-- CATEGORIES
-- ============================================================

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_categories_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_categories_id_tenant
        UNIQUE (id, tenant_id),

    CONSTRAINT uq_categories_tenant_name
        UNIQUE (tenant_id, name)
);

-- ============================================================
-- PRODUCTS
-- ============================================================

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    category_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    price INTEGER NOT NULL,
    cost INTEGER NOT NULL,
    minimum_stock INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_products_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_products_category_same_tenant
        FOREIGN KEY (category_id, tenant_id)
        REFERENCES categories(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_products_id_tenant
        UNIQUE (id, tenant_id),

    CONSTRAINT uq_products_tenant_sku
        UNIQUE (tenant_id, sku),

    CONSTRAINT ck_products_price
        CHECK (price >= 0),

    CONSTRAINT ck_products_cost
        CHECK (cost >= 0),

    CONSTRAINT ck_products_minimum_stock
        CHECK (minimum_stock >= 0)
);

-- ============================================================
-- PRODUCT STOCK
-- ============================================================

CREATE TABLE product_stocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    minimum_stock INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_product_stocks_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_product_stocks_outlet_same_tenant
        FOREIGN KEY (outlet_id, tenant_id)
        REFERENCES outlets(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_product_stocks_product_same_tenant
        FOREIGN KEY (product_id, tenant_id)
        REFERENCES products(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_product_stocks_outlet_product
        UNIQUE (outlet_id, product_id),

    CONSTRAINT uq_product_stocks_id_tenant
        UNIQUE (id, tenant_id),

    CONSTRAINT ck_product_stocks_minimum_stock
        CHECK (minimum_stock IS NULL OR minimum_stock >= 0)
);

-- ============================================================
-- TRANSACTIONS
-- ============================================================

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    cashier_id UUID NOT NULL,
    subtotal INTEGER NOT NULL,
    tax INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    status transaction_status NOT NULL DEFAULT 'PENDING',
    client_transaction_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_transactions_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_transactions_outlet_same_tenant
        FOREIGN KEY (outlet_id, tenant_id)
        REFERENCES outlets(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_transactions_cashier_same_tenant
        FOREIGN KEY (cashier_id, tenant_id)
        REFERENCES users(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_transactions_id_tenant
        UNIQUE (id, tenant_id),

    CONSTRAINT uq_transactions_client_id_tenant
        UNIQUE (tenant_id, client_transaction_id),

    CONSTRAINT ck_transactions_subtotal
        CHECK (subtotal >= 0),

    CONSTRAINT ck_transactions_tax
        CHECK (tax >= 0),

    CONSTRAINT ck_transactions_discount
        CHECK (discount >= 0),

    CONSTRAINT ck_transactions_total
        CHECK (total >= 0),

    CONSTRAINT ck_transactions_total_formula
        CHECK (total = subtotal + tax - discount)
);

-- ============================================================
-- TRANSACTION ITEMS
-- ============================================================

CREATE TABLE transaction_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    transaction_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    unit_cost INTEGER NOT NULL,
    subtotal INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_transaction_items_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_transaction_items_transaction_same_tenant
        FOREIGN KEY (transaction_id, tenant_id)
        REFERENCES transactions(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_transaction_items_product_same_tenant
        FOREIGN KEY (product_id, tenant_id)
        REFERENCES products(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_transaction_items_id_tenant
        UNIQUE (id, tenant_id),

    CONSTRAINT ck_transaction_items_quantity
        CHECK (quantity > 0),

    CONSTRAINT ck_transaction_items_unit_price
        CHECK (unit_price >= 0),

    CONSTRAINT ck_transaction_items_unit_cost
        CHECK (unit_cost >= 0),

    CONSTRAINT ck_transaction_items_subtotal
        CHECK (subtotal = quantity * unit_price)
);

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    transaction_id UUID NOT NULL,
    method payment_method NOT NULL,
    status payment_status NOT NULL DEFAULT 'PENDING',
    amount INTEGER NOT NULL,
    provider VARCHAR(50),
    provider_reference VARCHAR(255),
    paid_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_payments_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_payments_transaction_same_tenant
        FOREIGN KEY (transaction_id, tenant_id)
        REFERENCES transactions(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT uq_payments_id_tenant
        UNIQUE (id, tenant_id),

    CONSTRAINT ck_payments_amount
        CHECK (amount > 0),

    CONSTRAINT ck_payments_paid_at
        CHECK (
            (status = 'PAID' AND paid_at IS NOT NULL)
            OR
            (status <> 'PAID')
        )
);

CREATE UNIQUE INDEX uq_payments_provider_reference
    ON payments (provider, provider_reference)
    WHERE provider_reference IS NOT NULL;

-- ============================================================
-- STOCK MOVEMENTS
-- ============================================================

CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    product_id UUID NOT NULL,
    user_id UUID NOT NULL,
    type stock_movement_type NOT NULL,
    quantity INTEGER NOT NULL,
    reference_type VARCHAR(50),
    reference_id UUID,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_stock_movements_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_stock_movements_outlet_same_tenant
        FOREIGN KEY (outlet_id, tenant_id)
        REFERENCES outlets(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_stock_movements_product_same_tenant
        FOREIGN KEY (product_id, tenant_id)
        REFERENCES products(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_stock_movements_user_same_tenant
        FOREIGN KEY (user_id, tenant_id)
        REFERENCES users(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_stock_movements_id_tenant
        UNIQUE (id, tenant_id),

    CONSTRAINT ck_stock_movements_quantity_nonzero
        CHECK (quantity <> 0),

    CONSTRAINT ck_stock_movements_type_sign
        CHECK (
            (type IN ('SALE', 'PURCHASE', 'ADJUSTMENT', 'RETURN', 'VOID')
             AND quantity <> 0)
        )
);

-- ============================================================
-- STOCK ADJUSTMENTS
-- ============================================================

CREATE TABLE stock_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    product_id UUID NOT NULL,
    user_id UUID NOT NULL,
    type stock_adjustment_type NOT NULL,
    quantity INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_stock_adjustments_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_stock_adjustments_outlet_same_tenant
        FOREIGN KEY (outlet_id, tenant_id)
        REFERENCES outlets(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_stock_adjustments_product_same_tenant
        FOREIGN KEY (product_id, tenant_id)
        REFERENCES products(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_stock_adjustments_user_same_tenant
        FOREIGN KEY (user_id, tenant_id)
        REFERENCES users(id, tenant_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT uq_stock_adjustments_id_tenant
        UNIQUE (id, tenant_id),

    CONSTRAINT ck_stock_adjustments_quantity
        CHECK (quantity > 0),

    CONSTRAINT ck_stock_adjustments_reason
        CHECK (LENGTH(BTRIM(reason)) > 0)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_outlets_tenant_id
    ON outlets (tenant_id);

CREATE INDEX idx_users_tenant_id
    ON users (tenant_id);

CREATE INDEX idx_users_outlet_id
    ON users (outlet_id);

CREATE INDEX idx_categories_tenant_id
    ON categories (tenant_id);

CREATE INDEX idx_products_tenant_id
    ON products (tenant_id);

CREATE INDEX idx_products_category_id
    ON products (category_id);

CREATE INDEX idx_products_active
    ON products (tenant_id, is_active);

CREATE INDEX idx_product_stocks_tenant_id
    ON product_stocks (tenant_id);

CREATE INDEX idx_product_stocks_product_id
    ON product_stocks (product_id);

CREATE INDEX idx_product_stocks_low_stock
    ON product_stocks (outlet_id, product_id)
    WHERE quantity <= COALESCE(minimum_stock, 0);

CREATE INDEX idx_transactions_tenant_id
    ON transactions (tenant_id);

CREATE INDEX idx_transactions_outlet_created_at
    ON transactions (outlet_id, created_at DESC);

CREATE INDEX idx_transactions_cashier_id
    ON transactions (cashier_id);

CREATE INDEX idx_transactions_status
    ON transactions (tenant_id, status);

CREATE INDEX idx_transaction_items_transaction_id
    ON transaction_items (transaction_id);

CREATE INDEX idx_transaction_items_product_id
    ON transaction_items (product_id);

CREATE INDEX idx_payments_transaction_id
    ON payments (transaction_id);

CREATE INDEX idx_payments_status
    ON payments (tenant_id, status);

CREATE INDEX idx_stock_movements_product_outlet_created_at
    ON stock_movements (product_id, outlet_id, created_at DESC);

CREATE INDEX idx_stock_movements_tenant_created_at
    ON stock_movements (tenant_id, created_at DESC);

CREATE INDEX idx_stock_movements_reference
    ON stock_movements (reference_type, reference_id);

CREATE INDEX idx_stock_adjustments_product_outlet_created_at
    ON stock_adjustments (product_id, outlet_id, created_at DESC);

CREATE INDEX idx_stock_adjustments_tenant_created_at
    ON stock_adjustments (tenant_id, created_at DESC);

-- ============================================================
-- UPDATED_AT HELPER
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenants_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_outlets_updated_at
BEFORE UPDATE ON outlets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_categories_updated_at
BEFORE UPDATE ON categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_product_stocks_updated_at
BEFORE UPDATE ON product_stocks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ============================================================
-- END OF DATABASE_SCHEMA.sql
-- ============================================================
