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
const { test } = require('node:test');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { HeldOrdersService } = require('../src/held-orders/held-orders.service');
const { TransactionsService } = require('../src/transactions/transactions.service');
const { applyRepositoryMigrations, assertLatestMigrationApplied } = require('./helpers/test-migrations.cjs');

const connectionString = process.env.HELD_ORDER_TEST_DATABASE_URL || process.env.DATABASE_URL;

test('M16C Held Order conversion atomicity and rollback', { skip: !connectionString }, async (t) => {
  const schema = `held_order_m16c_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString });
  await admin.connect();

  let db;
  let heldOrdersService;
  let transactionsService;

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    const migrationNames = await applyRepositoryMigrations(admin, schema);
    await assertLatestMigrationApplied(admin, migrationNames);

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
      // M16G-0A: the service returns { transaction, replayed }. The helper
      // passes the envelope straight through so each test can assert both the
      // canonical transaction and the server-authoritative replay flag.
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

    // 6) successful conversion persists everything together
    await t.test('successful conversion commits all rows atomically', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await makeHeldOrder(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000, name: 'P', sku: 'S' }]);
      const clientTxId = randomUUID();

      const result = await checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 });

      // M16G-0A: fresh conversion -> replayed=false, wrapped canonical transaction.
      assert.equal(result.replayed, false, 'fresh conversion must report replayed=false');
      assert.deepEqual(Object.keys(result).sort(), ['replayed', 'transaction'], 'envelope carries exactly transaction and replayed');
      assert.equal(result.transaction.replayed, undefined, 'replay metadata must not leak into the canonical transaction');
      assert.equal(result.transaction.status, 'COMPLETED');

      const hoAfter = await db.held_orders.findUnique({ where: { id: ho.id } });
      assert.equal(hoAfter.status, 'CONVERTED');
      assert.equal(hoAfter.converted_transaction_id, result.transaction.transaction_id);
      assert.ok(hoAfter.converted_at instanceof Date);

      const tx = await db.transactions.findUnique({ where: { id: result.transaction.transaction_id }, include: { transaction_items: true, payments: true } });
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

      const movements = await db.stock_movements.findMany({ where: { reference_id: result.transaction.transaction_id } });
      assert.equal(movements.length, 1);
      assert.equal(movements[0].quantity, -2);
      assert.equal(movements[0].type, 'SALE');
      assert.equal(movements[0].reference_type, 'TRANSACTION');
    });

    // 6b) M16G-0A: idempotent retry against an already-CONVERTED held order
    await t.test('idempotent retry reports replayed=true with the same canonical transaction', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await makeHeldOrder(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000, name: 'P', sku: 'S' }]);
      const clientTxId = randomUUID();

      const original = await checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 });
      assert.equal(original.replayed, false, 'first call performs the conversion');

      const replay = await checkout(heldOrdersService, ho.id, clientTxId, { method: 'CASH', amount: 2200 });
      assert.equal(replay.replayed, true, 'exact retry must report replayed=true');
      assert.equal(replay.transaction.transaction_id, original.transaction.transaction_id, 'replay returns the same canonical transaction');

      // Replay must not create any new sale side effects.
      const txCount = await db.transactions.count({ where: { client_transaction_id: clientTxId, tenant_id: tenant.id } });
      assert.equal(txCount, 1, 'replay creates no second transaction');
      const paymentCount = await db.payments.count({ where: { tenant_id: tenant.id, transaction_id: original.transaction.transaction_id } });
      assert.equal(paymentCount, 1, 'replay creates no second payment');
      const stock = await db.product_stocks.findFirst({ where: { product_id: p.id, outlet_id: outlet.id } });
      assert.equal(stock.stock, 8, 'stock decremented exactly once across original + replay');
      const movementCount = await db.stock_movements.count({ where: { reference_id: original.transaction.transaction_id } });
      assert.equal(movementCount, 1, 'replay creates no second stock movement');

      const hoAfter = await db.held_orders.findUnique({ where: { id: ho.id } });
      assert.equal(hoAfter.status, 'CONVERTED');
      assert.equal(hoAfter.converted_transaction_id, original.transaction.transaction_id);
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

      // M16G-0A: exactly one caller performed the conversion, the other came
      // back through the validated replay path. Both share one canonical
      // transaction id, so physical side effects stay exactly-once.
      const flags = fulfilled.map(r => r.value.replayed).sort();
      assert.deepEqual(flags, [false, true], 'exactly one original (false) and one replay (true)');
      assert.equal(fulfilled[0].value.transaction.transaction_id, fulfilled[1].value.transaction.transaction_id);

      const hoAfter = await db.held_orders.findUnique({ where: { id: ho.id } });
      assert.equal(hoAfter.status, 'CONVERTED');
      assert.equal(hoAfter.converted_transaction_id, fulfilled[0].value.transaction.transaction_id);

      const stock = await db.product_stocks.findFirst({ where: { product_id: p.id, outlet_id: outlet.id } });
      assert.equal(stock.stock, 8, 'stock deducted exactly once');

      const txCount = await db.transactions.count({ where: { client_transaction_id: clientTxId, tenant_id: tenant.id } });
      assert.equal(txCount, 1, 'exactly one transaction created');

      const paymentCount = await db.payments.count({ where: { transaction_id: fulfilled[0].value.transaction.transaction_id } });
      assert.equal(paymentCount, 1, 'exactly one payment created');

      const movementCount = await db.stock_movements.count({ where: { reference_id: fulfilled[0].value.transaction.transaction_id } });
      assert.equal(movementCount, 1, 'exactly one stock movement created');
    });

    // 8) M16G-0A: normal POST /transactions response keeps its flat shape
    await t.test('normal transaction create is not wrapped and carries no replay metadata', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const clientTxId = randomUUID();

      const result = await transactionsService.create(actor, {
        outlet_id: outlet.id,
        cashier_session_id: session.id,
        client_transaction_id: clientTxId,
        items: [{ product_id: p.id, quantity: 2 }],
        payment: { method: 'QRIS' },
        discount: 0,
        customer_id: null,
      });

      // The canonical transaction stays at the top level; the M16G-0A envelope
      // belongs only to the held-order checkout contract.
      assert.equal(result.replayed, undefined, 'normal transaction must not report replayed');
      assert.equal(result.transaction, undefined, 'normal transaction must not be wrapped');
      assert.ok(result.transaction_id, 'normal transaction keeps its flat transaction_id');
      assert.equal(result.status, 'COMPLETED');
      assert.equal(result.client_transaction_id, clientTxId);
    });

  } finally {
    await db?.$disconnect();
    await admin.query('ROLLBACK');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
