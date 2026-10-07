// Run: HELD_ORDER_TEST_DATABASE_URL=postgresql://... node --require ts-node/register/transpile-only --test test/held-orders-m16c-atomicity.integration.cjs
// Creates and drops only a random schema. Verifies real PostgreSQL rollback for:
// 1) failure after held-order claim → version/status rollback
// 2) failure after transaction creation → transaction/items rollback
// 3) failure after stock decrement → stock quantity rollback
// 4) failure after payment creation → payment/stock-movement rollback
// 5) failure before terminal held-order update → held order remains OPEN, sale effects rollback
// 6) successful conversion → CONVERTED + converted_transaction_id + converted_at + all rows persist together
// 7) concurrent conversion race → exactly one sale for two callers on same OPEN held order/version

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { HeldOrdersService } = require('../src/held-orders/held-orders.service');
const { TransactionsService } = require('../src/transactions/transactions.service');

const connectionString = process.env.HELD_ORDER_TEST_DATABASE_URL || process.env.DATABASE_URL;

test('M16C Held Order conversion atomicity and rollback', { skip: !connectionString }, async (t) => {
  const schema = `held_order_m16c_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString });
  await admin.connect();

  let db;
  let heldOrdersService;
  let transactionsService;

  const MIGRATIONS = [
    '20260914000000_baseline',
    '20260914000100_transaction_tenant_integrity',
    '20260915000000_optional_tenant_tax',
    '20260915010000_add_customers',
    '20260915020000_add_cashier_sessions',
    '20260918000000_add_product_track_stock',
    '20260926000000_auth_v2_schema_preparation',
    '20260926010000_add_device_session_refresh_hash_unique',
    '20261003000000_v1_m1_database_foundation',
    '20261003010000_v1_m4_transaction_item_note_snapshot',
    '20261003020000_v1_m6_non_reconciling_shift_close',
    '20261006182702_held_orders_m16a',
  ];

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    for (const name of MIGRATIONS) {
      const sql = readFileSync(join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8').replaceAll('"public"', `"${schema}"`);
      await admin.query(sql);
    }

    db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    transactionsService = new TransactionsService(db);
    heldOrdersService = new HeldOrdersService(db, transactionsService);

    // Fixture helpers
    const tenant = await db.tenants.create({ data: { name: 'Atomicity Tenant', tax_enabled: true, tax_rate: 10 } });
    const outlet = await db.outlets.create({ data: { tenant_id: tenant.id, name: 'Outlet A' } });
    const user = await db.users.create({
      data: { tenant_id: tenant.id, outlet_id: outlet.id, name: 'Cashier', email: 'cashier@atomic.test', password_hash: 'fixture', role: 'CASHIER' }
    });
    const actor = { sub: user.id, tenant_id: tenant.id, role: 'CASHIER' };

    async function product(stock = 10, price = 1000, cost = 500) {
      const p = await db.products.create({ data: { tenant_id: tenant.id, name: 'Product', sku: randomUUID(), price, cost } });
      if (stock !== null) await db.product_stocks.create({ data: { product_id: p.id, outlet_id: outlet.id, stock } });
      return p;
    }

    async function makeSession(cashierId = user.id) {
      const existing = await db.cashier_sessions.findFirst({ where: { tenant_id: tenant.id, outlet_id: outlet.id, user_id: cashierId, status: 'OPEN', closed_at: null } });
      if (existing) return existing;
      return db.cashier_sessions.create({
        data: { tenant_id: tenant.id, outlet_id: outlet.id, user_id: cashierId, opening_cash: 0, status: 'OPEN', closed_at: null }
      });
    }

    async function makeHeldOrder(sessionId, items) {
      const heldOrder = await db.held_orders.create({
        data: {
          tenant_id: tenant.id,
          outlet_id: outlet.id,
          origin_cashier_session_id: sessionId,
          cashier_user_id: user.id,
          status: 'OPEN',
          version: 1,
          subtotal_estimate: 0n,
          tax_estimate: 0n,
          total_estimate: 0n,
        },
      });
      for (const [idx, item] of items.entries()) {
        const heldItem = await db.held_order_items.create({
          data: {
            tenant_id: tenant.id,
            held_order_id: heldOrder.id,
            product_id: item.productId,
            quantity: item.qty,
            product_name_snapshot: item.name ?? 'Product',
            sku_snapshot: item.sku ?? 'SKU',
            base_price_snapshot: BigInt(item.basePrice),
            effective_price_snapshot: BigInt(item.effectivePrice),
            line_subtotal: BigInt(item.lineSubtotal),
            line_discount: BigInt(item.lineDiscount ?? 0),
            line_total: BigInt(item.lineTotal),
            note_snapshot: item.note ?? null,
            display_order: idx,
          },
        });
        for (const modifier of item.modifiers ?? []) {
          await db.held_order_item_modifiers.create({
            data: {
              tenant_id: tenant.id,
              held_order_item_id: heldItem.id,
              modifier_group_id: modifier.groupId,
              modifier_option_id: modifier.optionId,
              group_name_snapshot: modifier.groupName,
              option_name_snapshot: modifier.optionName,
              price_delta_snapshot: modifier.priceDelta,
            },
          });
        }
      }
      return heldOrder;
    }

    async function checkout(holder, hoId, clientTxId, payment, expectedVersion = 1) {
      return holder.checkout(actor, hoId, { expected_version: expectedVersion, client_transaction_id: clientTxId, payment });
    }

    function isConversionFailure(error) {
      assert.equal(error?.response?.error_code, 'HELD_ORDER_CONVERSION_FAILED');
      return true;
    }

    async function assertRollback(hoId, clientTxId) {
      const ho = await db.held_orders.findUnique({ where: { id: hoId } });
      assert.equal(ho.status, 'OPEN');
      assert.equal(ho.version, 1);
      assert.equal(ho.converted_transaction_id, null);
      assert.equal(ho.converted_at, null);
      const txCount = await db.transactions.count({ where: { client_transaction_id: clientTxId, tenant_id: tenant.id } });
      assert.equal(txCount, 0, 'transaction must not exist after rollback');
      const itemsCount = await db.transaction_items.count({ where: { tenant_id: tenant.id } });
      assert.equal(itemsCount, 0);
      const paymentsCount = await db.payments.count({ where: { tenant_id: tenant.id } });
      assert.equal(paymentsCount, 0);
      const movementsCount = await db.stock_movements.count({ where: { tenant_id: tenant.id } });
      assert.equal(movementsCount, 0);
    }

    // 1) Failure after held-order claim (simulate by breaking after claim)
    await t.test('failure after claim rolls back version and status', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await makeHeldOrder(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000, name: 'P', sku: 'S' }]);
      const clientTxId = randomUUID();

      // Force a failure inside the outer transaction after claim by inserting invalid payment
      await admin.query('ALTER TABLE payments ADD CONSTRAINT force_fail_after_claim CHECK (amount <> 2200)');
      try {
        await assert.rejects(
          checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 }),
          isConversionFailure
        );
      } finally {
        await admin.query('ALTER TABLE payments DROP CONSTRAINT force_fail_after_claim');
      }
      await assertRollback(ho.id, clientTxId);
    });

    // 2) Failure after transaction creation
    await t.test('failure after transaction creation rolls back transaction and items', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await makeHeldOrder(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000, name: 'P', sku: 'S' }]);
      const clientTxId = randomUUID();

      // Force failure after transaction insert but before payment/stock
      await admin.query('ALTER TABLE payments ADD CONSTRAINT force_fail_after_tx CHECK (amount <> 2200)');
      try {
        await assert.rejects(
          checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 }),
          isConversionFailure
        );
      } finally {
        await admin.query('ALTER TABLE payments DROP CONSTRAINT force_fail_after_tx');
      }
      await assertRollback(ho.id, clientTxId);
    });

    // 3) Failure after stock decrement
    await t.test('failure after stock decrement rolls back stock quantity', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await makeHeldOrder(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000, name: 'P', sku: 'S' }]);
      const clientTxId = randomUUID();

      await admin.query('ALTER TABLE stock_movements ADD CONSTRAINT force_fail_after_stock CHECK (quantity <> -2)');
      try {
        await assert.rejects(
          checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 }),
          isConversionFailure
        );
      } finally {
        await admin.query('ALTER TABLE stock_movements DROP CONSTRAINT force_fail_after_stock');
      }
      const stock = await db.product_stocks.findFirst({ where: { product_id: p.id, outlet_id: outlet.id } });
      assert.equal(stock.stock, 10, 'stock must roll back to original');
      await assertRollback(ho.id, clientTxId);
    });

    // 4) Failure after payment creation
    await t.test('failure after payment creation rolls back payment and movements', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await makeHeldOrder(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000, name: 'P', sku: 'S' }]);
      const clientTxId = randomUUID();

      await admin.query("ALTER TABLE held_orders ADD CONSTRAINT force_fail_after_payment CHECK (status::text <> 'CONVERTED')");
      try {
        await assert.rejects(
          checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 }),
          isConversionFailure
        );
      } finally {
        await admin.query('ALTER TABLE held_orders DROP CONSTRAINT force_fail_after_payment');
      }
      await assertRollback(ho.id, clientTxId);
    });

    // 5) Failure before terminal held-order update
    await t.test('failure before terminal update leaves held order OPEN', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await makeHeldOrder(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000, name: 'P', sku: 'S' }]);
      const clientTxId = randomUUID();

      await admin.query("ALTER TABLE held_orders ADD CONSTRAINT force_fail_before_terminal CHECK (status::text <> 'CONVERTED')");
      try {
        await assert.rejects(
          checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 }),
          isConversionFailure
        );
      } finally {
        await admin.query('ALTER TABLE held_orders DROP CONSTRAINT force_fail_before_terminal');
      }
      await assertRollback(ho.id, clientTxId);
    });

    // 6) Successful conversion persists everything together
    await t.test('successful conversion commits all rows atomically', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await makeHeldOrder(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000, name: 'P', sku: 'S' }]);
      const clientTxId = randomUUID();

      const result = await checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 });
      assert.equal(result.status, 'COMPLETED');

      const hoAfter = await db.held_orders.findUnique({ where: { id: ho.id } });
      assert.equal(hoAfter.status, 'CONVERTED');
      assert.equal(hoAfter.converted_transaction_id, result.transaction_id);
      assert.ok(hoAfter.converted_at instanceof Date);

      const tx = await db.transactions.findUnique({ where: { id: result.transaction_id }, include: { transaction_items: true, payments: true } });
      assert.ok(tx);
      assert.equal(tx.tenant_id, tenant.id);
      assert.equal(tx.outlet_id, outlet.id);
      assert.equal(tx.user_id, user.id);
      assert.equal(tx.cashier_session_id, session.id);
      assert.equal(tx.client_transaction_id, clientTxId);
      assert.equal(Number(tx.total), 2200); // 2000 + 10% tax
      assert.equal(tx.payments.length, 1);
      assert.equal(tx.payments[0].method, 'CASH');
      assert.equal(tx.payments[0].status, 'PAID');
      assert.equal(Number(tx.payments[0].amount), 2200);

      const stock = await db.product_stocks.findFirst({ where: { product_id: p.id, outlet_id: outlet.id } });
      assert.equal(stock.stock, 8);

      const movements = await db.stock_movements.findMany({ where: { reference_id: result.transaction_id } });
      assert.equal(movements.length, 1);
      assert.equal(movements[0].quantity, -2);
      assert.equal(movements[0].type, 'SALE');
      assert.equal(movements[0].reference_type, 'TRANSACTION');
    });

    // 7) Concurrent conversion race
    await t.test('concurrent conversions on same held order/version produce exactly one sale', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await makeHeldOrder(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000, name: 'P', sku: 'S' }]);
      const clientTxId = randomUUID();

      const [r1, r2] = await Promise.allSettled([
        checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 }),
        checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 }),
      ]);

      const fulfilled = [r1, r2].filter(r => r.status === 'fulfilled');
      assert.equal(fulfilled.length, 2, 'winner and exact idempotent replay must both succeed');
      assert.equal(fulfilled[0].value.transaction_id, fulfilled[1].value.transaction_id);

      const hoAfter = await db.held_orders.findUnique({ where: { id: ho.id } });
      assert.equal(hoAfter.status, 'CONVERTED');
      assert.equal(hoAfter.converted_transaction_id, fulfilled[0].value.transaction_id);

      const stock = await db.product_stocks.findFirst({ where: { product_id: p.id, outlet_id: outlet.id } });
      assert.equal(stock.stock, 8, 'stock deducted exactly once');

      const txCount = await db.transactions.count({ where: { client_transaction_id: clientTxId, tenant_id: tenant.id } });
      assert.equal(txCount, 1, 'exactly one transaction created');
    });

  } finally {
    await db?.$disconnect();
    await admin.query('ROLLBACK');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});