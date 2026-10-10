// Run: SHIFT_TEST_DATABASE_URL=postgresql://... TS_NODE_PROJECT=test/tsconfig.hardening.json node --require ts-node/register/transpile-only --test test/shifts-m16d-held-orders-close.integration.cjs
// M16D: Real PostgreSQL acceptance test for blocking shift close when OPEN Held Orders exist.

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

// Dynamic require for ESM modules
const { ShiftsService } = require('../src/shifts/shifts.service');
const { HeldOrdersService } = require('../src/held-orders/held-orders.service');
const { TransactionsService } = require('../src/transactions/transactions.service');
const { applyRepositoryMigrations, assertLatestMigrationApplied } = require('./helpers/test-migrations.cjs');

const connectionString = process.env.SHIFT_TEST_DATABASE_URL || process.env.DATABASE_URL;

test('M16D Block Shift Close When OPEN Held Orders Exist', { skip: !connectionString }, async (t) => {
  const schema = `shift_m16d_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString });
  await admin.connect();

  let db;
  let shiftsService;
  let heldOrdersService;
  let transactionsService;

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    const migrationNames = await applyRepositoryMigrations(admin, schema);
    await assertLatestMigrationApplied(admin, migrationNames);

    // Prisma's adapter schema scopes generated ORM queries, but raw SQL still
    // resolves through PostgreSQL search_path. Point both at the disposable
    // schema so the service's unqualified SELECT ... FOR UPDATE locks the same
    // cashier_sessions row that Prisma reads and writes.
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
    });
    transactionsService = new TransactionsService(db);
    heldOrdersService = new HeldOrdersService(db, transactionsService);
    shiftsService = new ShiftsService(db);

    // Fixture helpers
    const tenant = await db.tenants.create({ data: { name: 'M16D Tenant', tax_enabled: true, tax_rate: 10 } });
    const outlet = await db.outlets.create({ data: { tenant_id: tenant.id, name: 'Outlet A' } });
    const user = await db.users.create({
      data: { tenant_id: tenant.id, outlet_id: outlet.id, name: 'Cashier', email: 'cashier@m16d.test', password_hash: 'fixture', role: 'CASHIER' }
    });
    const actor = { sub: user.id, tenant_id: tenant.id, role: 'CASHIER' };

    async function product(stock = 10, price = 1000) {
      const p = await db.products.create({ data: { tenant_id: tenant.id, name: 'Product', sku: randomUUID(), price, cost: 500 } });
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

    async function closeShift(actorObj, sessionId) {
      return shiftsService.close(actorObj, sessionId, {});
    }

    // Create an OPEN held order via the SERVICE (not raw SQL) so the M16D
    // session-row lock is actually taken.
    async function createHeldOrderViaService(sessionId, items, { actorObj = actor, outletId = outlet.id } = {}) {
      const input = {
        outlet_id: outletId,
        cashier_session_id: sessionId,
        items: items.map((item) => ({
          product_id: item.productId,
          quantity: item.qty,
          note: item.note,
          modifier_option_ids: item.modifierOptionIds ?? [],
        })),
      };
      return heldOrdersService.create(actorObj, input);
    }

    // Reset operational state so each case (and each race iteration) starts
    // from a session with no OPEN held orders.
    async function resetOperationalState() {
      await db.held_orders.updateMany({
        where: { status: 'OPEN' },
        data: { status: 'CANCELLED', cancelled_at: new Date() },
      });
      await db.cashier_sessions.updateMany({
        where: { status: 'OPEN' },
        data: { status: 'CLOSED', closed_at: new Date() },
      });
    }

    t.beforeEach(async () => {
      await resetOperationalState();
    });

    // 1) Zero Held Orders -> close succeeds
    await t.test('zero held orders allows close', async () => {
      const session = await makeSession();
      const result = await closeShift(actor, session.id);
      assert.equal(result.status, 'CLOSED');
      assert.ok(result.closed_at instanceof Date);
    });

    // 2) Only CONVERTED orders -> close succeeds
    await t.test('converted held orders do not block close', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }]);
      // Convert via service
      await heldOrdersService.checkout(actor, ho.held_order_id, {
        expected_version: 1,
        client_transaction_id: randomUUID(),
        payment: { method: 'CASH', amount: 1100 },
      });
      const result = await closeShift(actor, session.id);
      assert.equal(result.status, 'CLOSED');
    });

    // 3) Only CANCELLED orders -> close succeeds
    await t.test('cancelled held orders do not block close', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }]);
      await heldOrdersService.cancel(actor, ho.held_order_id, { expected_version: 1 });
      const result = await closeShift(actor, session.id);
      assert.equal(result.status, 'CLOSED');
    });

    // 4) One OPEN Held Order -> 409 OPEN_HELD_ORDERS_EXIST
    await t.test('one OPEN held order blocks close with OPEN_HELD_ORDERS_EXIST', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      await createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }]);
      await assert.rejects(
        closeShift(actor, session.id),
        (err) => err.response?.error_code === 'OPEN_HELD_ORDERS_EXIST' && err.status === 409
      );
    });

    // 5) Multiple OPEN Held Orders -> same conflict
    await t.test('multiple OPEN held orders block close with OPEN_HELD_ORDERS_EXIST', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      await createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }]);
      await createHeldOrderViaService(session.id, [{ productId: p.id, qty: 2, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 2000, lineTotal: 2000 }]);
      await assert.rejects(
        closeShift(actor, session.id),
        (err) => err.response?.error_code === 'OPEN_HELD_ORDERS_EXIST' && err.status === 409
      );
    });

    // 6) OPEN Held Order from another session -> does not block
    await t.test('OPEN held order from another session does not block close', async () => {
      const otherUser = await db.users.create({
        data: { tenant_id: tenant.id, outlet_id: outlet.id, name: 'Other Cashier', email: 'other@m16d.test', password_hash: 'fixture', role: 'CASHIER' }
      });
      const session1 = await makeSession();
      const session2 = await makeSession(otherUser.id);
      const p = await product(10, 1000);
      const otherActor = { sub: otherUser.id, tenant_id: tenant.id, role: 'CASHIER' };
      await createHeldOrderViaService(session2.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }], { actorObj: otherActor });
      const result = await closeShift(actor, session1.id);
      assert.equal(result.status, 'CLOSED');
    });

    // 7) OPEN Held Order from another tenant -> does not block
    await t.test('OPEN held order from another tenant does not block close', async () => {
      const otherTenant = await db.tenants.create({ data: { name: 'Other Tenant', tax_enabled: true, tax_rate: 10 } });
      const otherOutlet = await db.outlets.create({ data: { tenant_id: otherTenant.id, name: 'Other Outlet' } });
      const otherUser = await db.users.create({
        data: { tenant_id: otherTenant.id, outlet_id: otherOutlet.id, name: 'Other Cashier', email: 'other@m16d.test', password_hash: 'fixture', role: 'CASHIER' }
      });
      const otherSession = await db.cashier_sessions.create({
        data: { tenant_id: otherTenant.id, outlet_id: otherOutlet.id, user_id: otherUser.id, opening_cash: 0, status: 'OPEN', closed_at: null }
      });
      await db.held_orders.create({
        data: {
          tenant_id: otherTenant.id,
          outlet_id: otherOutlet.id,
          origin_cashier_session_id: otherSession.id,
          cashier_user_id: otherUser.id,
          status: 'OPEN',
          version: 1,
          subtotal_estimate: 0n,
          tax_estimate: 0n,
          total_estimate: 0n,
        },
      });

      const session = await makeSession();
      const result = await closeShift(actor, session.id);
      assert.equal(result.status, 'CLOSED');
    });

    // 8) OPEN Held Order from another outlet in same tenant -> does not incorrectly block
    await t.test('OPEN held order from another outlet in same tenant does not block close', async () => {
      const otherOutlet2 = await db.outlets.create({ data: { tenant_id: tenant.id, name: 'Outlet B' } });
      const otherUser2 = await db.users.create({
        data: { tenant_id: tenant.id, outlet_id: otherOutlet2.id, name: 'Other Cashier 2', email: 'other2@m16d.test', password_hash: 'fixture', role: 'CASHIER' }
      });
      const otherSession = await db.cashier_sessions.create({
        data: { tenant_id: tenant.id, outlet_id: otherOutlet2.id, user_id: otherUser2.id, opening_cash: 0, status: 'OPEN', closed_at: null }
      });
      const p = await product(10, 1000);
      const otherActor2 = { sub: otherUser2.id, tenant_id: tenant.id, role: 'CASHIER' };
      await createHeldOrderViaService(otherSession.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }], { actorObj: otherActor2, outletId: otherOutlet2.id });

      const session = await makeSession();
      const result = await closeShift(actor, session.id);
      assert.equal(result.status, 'CLOSED');
    });

    // 9) Blocked close leaves session OPEN
    await t.test('blocked close leaves session OPEN', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      await createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }]);
      await assert.rejects(closeShift(actor, session.id), (err) => err.response?.error_code === 'OPEN_HELD_ORDERS_EXIST');
      const after = await db.cashier_sessions.findUnique({ where: { id: session.id } });
      assert.equal(after.status, 'OPEN');
      assert.equal(after.closed_at, null);
    });

    // 10) Blocked close leaves closed_at null
    await t.test('blocked close leaves closed_at null', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      await createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }]);
      await assert.rejects(closeShift(actor, session.id), (err) => err.response?.error_code === 'OPEN_HELD_ORDERS_EXIST');
      const after = await db.cashier_sessions.findUnique({ where: { id: session.id } });
      assert.equal(after.closed_at, null);
    });

    // 11) Blocked close causes no close-side effects
    await t.test('blocked close causes no close-side effects', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      await createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }]);
      await assert.rejects(closeShift(actor, session.id), (err) => err.response?.error_code === 'OPEN_HELD_ORDERS_EXIST');
      // Verify no transaction or other side effects were created
      const txCount = await db.transactions.count({ where: { cashier_session_id: session.id } });
      assert.equal(txCount, 0);
    });

    // 12) Existing authorization behavior remains intact
    await t.test('authorization still enforced when held orders check passes', async () => {
      const session = await makeSession();
      const otherUser = await db.users.create({
        data: { tenant_id: tenant.id, outlet_id: outlet.id, name: 'Other Cashier', email: 'other3@m16d.test', password_hash: 'fixture', role: 'CASHIER' }
      });
      const otherActor = { sub: otherUser.id, tenant_id: tenant.id, role: 'CASHIER' };
      await assert.rejects(
        closeShift(otherActor, session.id),
        (err) => err.response?.error_code === 'SHIFT_ACCESS_DENIED' && err.status === 403
      );
    });

    // 13) CONCURRENCY RACE: Close shift vs concurrent held order creation (service path)
    await t.test('repeated concurrent close and held order creation via service preserve the invariant', async () => {
      const p = await product(10, 1000);
      const outcomes = { createWins: 0, closeWins: 0, bothWin: 0, bothLose: 0 };

      // Alternate launch order and repeat the real service race. Scheduling is
      // intentionally not assumed; every observed schedule must produce one
      // success, one domain rejection, and never the forbidden final state.
      for (let iteration = 0; iteration < 12; iteration += 1) {
        if (iteration > 0) await resetOperationalState();
        const session = await makeSession();
        const create = () => createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1 }]);
        const close = () => closeShift(actor, session.id);
        const operations = iteration % 2 === 0 ? [create(), close()] : [close(), create()];
        const [first, second] = await Promise.allSettled(operations);
        const results = iteration % 2 === 0 ? { create: first, close: second } : { close: first, create: second };

        const finalSession = await db.cashier_sessions.findUnique({ where: { id: session.id } });
        const hoCount = await db.held_orders.count({
          where: {
            tenant_id: tenant.id,
            origin_cashier_session_id: session.id,
            status: 'OPEN',
          },
        });

        const createOk = results.create.status === 'fulfilled';
        const closeOk = results.close.status === 'fulfilled';

        if (createOk && closeOk) {
          outcomes.bothWin += 1;
        } else if (!createOk && !closeOk) {
          outcomes.bothLose += 1;
        } else if (createOk) {
          outcomes.createWins += 1;
          assert.equal(results.close.status, 'rejected');
          assert.equal(results.close.reason.response?.error_code, 'OPEN_HELD_ORDERS_EXIST');
          assert.equal(finalSession.status, 'OPEN');
          assert.equal(finalSession.closed_at, null);
          assert.equal(hoCount, 1);
        } else {
          outcomes.closeWins += 1;
          assert.equal(results.close.status, 'fulfilled');
          assert.equal(results.create.reason.response?.error_code, 'INVALID_CASHIER_SESSION');
          assert.equal(finalSession.status, 'CLOSED');
          assert.equal(hoCount, 0, 'No OPEN held orders should exist for a closed session');
        }
      }

      assert.equal(outcomes.bothWin, 0, 'Forbidden state: both operations succeeded');
      assert.equal(outcomes.bothLose, 0, 'Both operations failed unexpectedly');
      assert.equal(outcomes.createWins + outcomes.closeWins, 12);
    });

    // 14) Deterministic close-wins schedule: once close commits, a subsequent
    // service-mediated create must revalidate the locked session as CLOSED.
    await t.test('held order create after close fails with INVALID_CASHIER_SESSION', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const result = await closeShift(actor, session.id);
      assert.equal(result.status, 'CLOSED');
      await assert.rejects(
        createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1 }]),
        (err) => err.response?.error_code === 'INVALID_CASHIER_SESSION' && err.status === 403,
      );
      const hoCount = await db.held_orders.count({
        where: { tenant_id: tenant.id, origin_cashier_session_id: session.id, status: 'OPEN' },
      });
      assert.equal(hoCount, 0);
    });

    // 15) Interaction with conversion: if held order is converted, close should succeed
    await t.test('converted held order does not block close even if conversion happened just before', async () => {
      const session = await makeSession();
      const p = await product(10, 1000);
      const ho = await createHeldOrderViaService(session.id, [{ productId: p.id, qty: 1, basePrice: 1000, effectivePrice: 1000, lineSubtotal: 1000, lineTotal: 1000 }]);
      // Convert the held order
      await heldOrdersService.checkout(actor, ho.held_order_id, {
        expected_version: 1,
        client_transaction_id: randomUUID(),
        payment: { method: 'CASH', amount: 1100 },
      });
      // Now close should succeed
      const result = await closeShift(actor, session.id);
      assert.equal(result.status, 'CLOSED');
    });

  } finally {
    await db?.$disconnect();
    await admin.query('ROLLBACK');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
