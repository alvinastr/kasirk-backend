// Run with: npm run test:sync
// The test creates and drops only a random PostgreSQL schema.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { Test } = require('@nestjs/testing');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const { Client } = require('pg');
const request = require('supertest');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/prisma/prisma.service');

const connectionString =
  process.env.SYNC_TEST_DATABASE_URL || process.env.DATABASE_URL;

test(
  'Offline transaction sync HTTP API',
  { skip: !connectionString },
  async (t) => {
    const schema = `sync_${randomUUID().replaceAll('-', '')}`;
    const adminConnection = new Client({ connectionString });
    await adminConnection.connect();
    let db;
    let app;

    try {
      await adminConnection.query(`CREATE SCHEMA "${schema}"`);
      await adminConnection.query(`SET search_path TO "${schema}"`);
      const migrationsDirectory = join(__dirname, '../prisma/migrations');
      for (const name of readdirSync(migrationsDirectory).sort()) {
        const migrationFile = join(migrationsDirectory, name, 'migration.sql');
        if (!existsSync(migrationFile)) continue;
        const sql = readFileSync(migrationFile, 'utf8').replaceAll(
          '"public"',
          `"${schema}"`,
        );
        await adminConnection.query(sql);
      }

      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString }, { schema }),
      });
      const testingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(db)
        .compile();
      app = testingModule.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
      await app.init();

      const http = request(app.getHttpServer());
      const jwt = testingModule.get(JwtService);
      const tenant = await db.tenants.create({ data: { name: 'Sync Tenant' } });
      const otherTenant = await db.tenants.create({
        data: { name: 'Foreign Sync Tenant' },
      });
      const outlet = await db.outlets.create({
        data: { tenant_id: tenant.id, name: 'Sync Outlet' },
      });
      const foreignOutlet = await db.outlets.create({
        data: { tenant_id: otherTenant.id, name: 'Foreign Outlet' },
      });
      const owner = await db.users.create({
        data: {
          tenant_id: tenant.id,
          name: 'Owner',
          email: 'owner@sync.test',
          password_hash: 'fixture',
          role: 'OWNER',
        },
      });
      const cashier = await db.users.create({
        data: {
          tenant_id: tenant.id,
          outlet_id: outlet.id,
          name: 'Cashier',
          email: 'cashier@sync.test',
          password_hash: 'fixture',
          role: 'CASHIER',
        },
      });
      const cashierWithoutShift = await db.users.create({
        data: {
          tenant_id: tenant.id,
          outlet_id: outlet.id,
          name: 'Cashier Without Shift',
          email: 'cashier-no-shift@sync.test',
          password_hash: 'fixture',
          role: 'CASHIER',
        },
      });
      const foreignOwner = await db.users.create({
        data: {
          tenant_id: otherTenant.id,
          name: 'Foreign Owner',
          email: 'foreign-owner@sync.test',
          password_hash: 'fixture',
          role: 'OWNER',
        },
      });
      const product = await db.products.create({
        data: {
          tenant_id: tenant.id,
          name: 'Offline Product',
          sku: 'OFFLINE-PRODUCT',
          price: 100,
          cost: 50,
        },
      });
      const foreignProduct = await db.products.create({
        data: {
          tenant_id: otherTenant.id,
          name: 'Foreign Product',
          sku: 'FOREIGN-PRODUCT',
          price: 100,
          cost: 50,
        },
      });
      await db.product_stocks.createMany({
        data: [
          { outlet_id: outlet.id, product_id: product.id, stock: 20 },
          {
            outlet_id: foreignOutlet.id,
            product_id: foreignProduct.id,
            stock: 10,
          },
        ],
      });

      const token = (user) =>
        jwt.sign({
          sub: user.id,
          tenant_id: user.tenant_id,
          role: user.role,
        });
      const tokens = {
        owner: token(owner),
        cashier: token(cashier),
        cashierWithoutShift: token(cashierWithoutShift),
        foreignOwner: token(foreignOwner),
      };
      const auth = (requestBuilder, accessToken) =>
        requestBuilder.set('Authorization', `Bearer ${accessToken}`);
      const transaction = (
        clientTransactionId = randomUUID(),
        quantity = 1,
        transactionOutlet = outlet,
        transactionProduct = product,
      ) => ({
        client_transaction_id: clientTransactionId,
        outlet_id: transactionOutlet.id,
        items: [{ product_id: transactionProduct.id, quantity }],
        payment: { method: 'CASH', amount: quantity * 100 },
      });
      const sync = (accessToken, transactions) =>
        auth(
          http.post('/sync/transactions').send({ transactions }),
          accessToken,
        );

      await t.test('RC2 sync without a shift persists NULL session and settled CASH tender', async () => {
        const input = transaction(randomUUID(), 2);
        input.payment.amount = 50_000;
        const response = await sync(tokens.cashierWithoutShift, [input]).expect(201);
        assert.equal(response.body.synced, 1);
        const sale = response.body.results[0].transaction;
        assert.equal(sale.cashier_session_id, null);
        assert.equal(sale.total, 200);
        assert.equal(sale.payments[0].amount, 200);
        assert.equal(sale.payments[0].amount_received, 50_000);
        assert.equal(sale.payments[0].change_amount, 49_800);
        const stored = await db.transactions.findUniqueOrThrow({ where: { id: sale.transaction_id } });
        assert.equal(stored.cashier_session_id, null);
        await db.product_stocks.update({ where: { outlet_id_product_id: { outlet_id: outlet.id, product_id: product.id } }, data: { stock: 20 } });
      });

      await t.test('JWT, nested DTO, and real V1 session are required', async () => {
        await http
          .post('/sync/transactions')
          .send({ transactions: [] })
          .expect(401);
        await sync(tokens.owner, []).expect(400);

        const input = { ...transaction(), cashier_session_id: randomUUID() };
        const response = await sync(tokens.cashierWithoutShift, [input]).expect(201);
        assert.equal(response.body.results[0].error.error_code, 'INVALID_CASHIER_SESSION');
        assert.equal(
          await db.transactions.count({
            where: { client_transaction_id: input.client_transaction_id },
          }),
          0,
        );
      });

      const openedShift = await auth(
        http
          .post('/shifts/open')
          .send({ outlet_id: outlet.id, opening_cash: 0 }),
        tokens.cashier,
      ).expect(201);
      const cashierSessionId = openedShift.body.shift_id;

      let firstInput;
      let firstTransactionId;
      await t.test(
        'successful V1 sync preserves explicit session and checkout behavior',
        async () => {
          firstInput = { ...transaction(randomUUID(), 2), cashier_session_id: cashierSessionId };
          const response = await sync(tokens.cashier, [firstInput]).expect(201);
          assert.equal(response.body.total, 1);
          assert.equal(response.body.synced, 1);
          assert.equal(response.body.failed, 0);
          assert.equal(response.body.results[0].status, 'SYNCED');

          const synced = response.body.results[0].transaction;
          firstTransactionId = synced.transaction_id;
          assert.equal(synced.cashier_session_id, cashierSessionId);
          assert.equal((await db.transactions.findUniqueOrThrow({ where: { id: firstTransactionId } })).cashier_session_id, cashierSessionId);
          assert.equal(
            synced.client_transaction_id,
            firstInput.client_transaction_id,
          );
          assert.equal(synced.status, 'COMPLETED');
          assert.equal(synced.total, 200);
          assert.equal(synced.payments[0].status, 'PAID');
          assert.equal(synced.payments[0].method, 'CASH');

          const movement = await db.stock_movements.findFirstOrThrow({
            where: { reference_id: firstTransactionId },
          });
          assert.equal(movement.type, 'SALE');
          assert.equal(movement.quantity, -2);
          assert.equal(
            (
              await db.product_stocks.findUniqueOrThrow({
                where: {
                  outlet_id_product_id: {
                    outlet_id: outlet.id,
                    product_id: product.id,
                  },
                },
              })
            ).stock,
            18,
          );
        },
      );

      await t.test('duplicate sync is idempotent', async () => {
        const response = await sync(tokens.cashier, [firstInput]).expect(201);
        assert.equal(
          response.body.results[0].transaction.transaction_id,
          firstTransactionId,
        );
        assert.equal(
          await db.transactions.count({
            where: { client_transaction_id: firstInput.client_transaction_id },
          }),
          1,
        );
        assert.equal(
          await db.stock_movements.count({
            where: { reference_id: firstTransactionId, type: 'SALE' },
          }),
          1,
        );
        assert.equal(
          (
            await db.product_stocks.findUniqueOrThrow({
              where: {
                outlet_id_product_id: {
                  outlet_id: outlet.id,
                  product_id: product.id,
                },
              },
            })
          ).stock,
          18,
        );
      });

      await t.test(
        'multiple queued transactions sync in request order',
        async () => {
          const inputs = [
            transaction(randomUUID(), 1),
            transaction(randomUUID(), 2),
          ];
          const response = await sync(tokens.cashier, inputs).expect(201);
          assert.equal(response.body.total, 2);
          assert.equal(response.body.synced, 2);
          assert.equal(response.body.failed, 0);
          assert.deepEqual(
            response.body.results.map((result) => result.client_transaction_id),
            inputs.map((input) => input.client_transaction_id),
          );
          assert.ok(
            response.body.results.every((result) => result.status === 'SYNCED'),
          );
          assert.equal(
            (
              await db.product_stocks.findUniqueOrThrow({
                where: {
                  outlet_id_product_id: {
                    outlet_id: outlet.id,
                    product_id: product.id,
                  },
                },
              })
            ).stock,
            15,
          );
        },
      );

      await t.test(
        'insufficient stock rolls back its checkout and does not block later records',
        async () => {
          const insufficient = transaction(randomUUID(), 100);
          const valid = transaction(randomUUID(), 1);
          const transactionCount = await db.transactions.count();
          const movementCount = await db.stock_movements.count();

          const response = await sync(tokens.cashier, [
            insufficient,
            valid,
          ]).expect(201);
          assert.equal(response.body.synced, 1);
          assert.equal(response.body.failed, 1);
          assert.equal(response.body.results[0].status, 'FAILED');
          assert.equal(
            response.body.results[0].error.error_code,
            'INSUFFICIENT_STOCK',
          );
          assert.equal(response.body.results[1].status, 'SYNCED');
          assert.equal(
            await db.transactions.count({
              where: {
                client_transaction_id: insufficient.client_transaction_id,
              },
            }),
            0,
          );
          assert.equal(await db.transactions.count(), transactionCount + 1);
          assert.equal(await db.stock_movements.count(), movementCount + 1);
          assert.equal(
            (
              await db.product_stocks.findUniqueOrThrow({
                where: {
                  outlet_id_product_id: {
                    outlet_id: outlet.id,
                    product_id: product.id,
                  },
                },
              })
            ).stock,
            14,
          );
        },
      );

      await t.test(
        'foreign tenant resources are never synchronized',
        async () => {
          const foreignInput = transaction(
            randomUUID(),
            1,
            foreignOutlet,
            foreignProduct,
          );
          const response = await sync(tokens.owner, [foreignInput]).expect(201);
          assert.equal(response.body.synced, 0);
          assert.equal(response.body.failed, 1);
          assert.equal(response.body.results[0].status, 'FAILED');
          assert.equal(response.body.results[0].error.status_code, 404);
          assert.equal(
            await db.transactions.count({
              where: {
                client_transaction_id: foreignInput.client_transaction_id,
              },
            }),
            0,
          );
          assert.equal(
            (
              await db.product_stocks.findUniqueOrThrow({
                where: {
                  outlet_id_product_id: {
                    outlet_id: foreignOutlet.id,
                    product_id: foreignProduct.id,
                  },
                },
              })
            ).stock,
            10,
          );

          const reverseInput = transaction(randomUUID(), 1);
          const reverse = await sync(tokens.foreignOwner, [
            reverseInput,
          ]).expect(201);
          assert.equal(reverse.body.results[0].status, 'FAILED');
          assert.equal(reverse.body.results[0].error.status_code, 404);
          assert.equal(
            await db.transactions.count({
              where: {
                client_transaction_id: reverseInput.client_transaction_id,
              },
            }),
            0,
          );
        },
      );
      const v1 = () => ({ ...transaction(), cashier_session_id: cashierSessionId, payment: { method: 'CASH', amount_received: 500 } });
      await t.test('M9-1 normal POST still requires session', async () => {
        await auth(http.post('/transactions').send(transaction()), tokens.cashier).expect(400);
      });
      for (const [label, change] of [
        ['amount_received', r => { r.payment = { method: 'CASH', amount_received: 500 }; }],
        ['modifiers', r => { r.items[0].modifier_option_ids = []; }],
        ['note', r => { r.items[0].note = ''; }],
        ['mixed tender', r => { r.payment.amount_received = 500; }],
        ['QRIS', r => { r.payment = { method: 'QRIS' }; }],
        ['discount', r => { r.discount = 0; }],
        ['null session', r => { r.cashier_session_id = null; }],
        ['invalid quantity', r => { r.items[0].quantity = 0; }],
      ]) {
        await t.test(`M9-16/26-32 rejects ${label} before any batch writes`, async () => {
          const good = transaction(); const bad = transaction(); change(bad);
          const before = await db.transactions.count();
          await sync(tokens.cashier, [good, bad]).expect(400);
          assert.equal(await db.transactions.count(), before);
        });
      }
      await t.test('M9-2-9/20/24/25/31 mixed batch keeps legacy NULL and V1 session, tender, retry and summary', async () => {
        const summary = async () => (await auth(http.get(`/shifts/${cashierSessionId}/summary`), tokens.cashier).expect(200)).body;
        const before = await summary();
        const legacy = transaction(); const current = v1();
        const result = (await sync(tokens.cashier, [legacy, current]).expect(201)).body;
        assert.equal(result.synced, 2);
        const [oldSale, newSale] = result.results.map(r => r.transaction);
        assert.equal(oldSale.cashier_session_id, null);
        assert.equal(newSale.cashier_session_id, cashierSessionId);
        assert.equal(newSale.payments[0].amount_received, 500);
        assert.equal(newSale.payments[0].change_amount, 400);
        assert.equal((await db.transactions.findUniqueOrThrow({ where: { id: oldSale.transaction_id } })).cashier_session_id, null);
        const after = await summary();
        assert.equal(after.transaction_count, before.transaction_count + 1);
        assert.equal(after.totals.sales, before.totals.sales + 100);
        const retry = (await sync(tokens.cashier, [legacy]).expect(201)).body;
        assert.equal(retry.results[0].transaction.transaction_id, oldSale.transaction_id);
        for (const mismatch of [
          { ...legacy, payment: { method: 'CASH', amount: 500 } },
          { ...legacy, cashier_session_id: cashierSessionId },
        ]) {
          const rejected = (await sync(tokens.cashier, [mismatch]).expect(201)).body;
          assert.equal(rejected.results[0].error.error_code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
        }
      });
      await t.test('M9-6 exact 20k settled and 50k tender', async () => {
        const p = await db.products.create({ data: { tenant_id: tenant.id, name: '20k', sku: randomUUID(), price: 20000, track_stock: false } });
        const row = transaction(randomUUID(), 1, outlet, p); row.payment.amount = 50000;
        const sale = (await sync(tokens.cashierWithoutShift, [row]).expect(201)).body.results[0].transaction;
        const pay = await db.payments.findFirstOrThrow({ where: { transaction_id: sale.transaction_id } });
        assert.equal(pay.amount, 20000n); assert.equal(pay.amount_received, 50000n); assert.equal(pay.change_amount, 30000n);
      });
      await t.test('M9-11/12 separate foreign product and customer rejected', async () => {
        const customer = await db.customers.create({ data: { tenant_id: otherTenant.id, name: 'Foreign' } });
        for (const row of [transaction(randomUUID(), 1, outlet, foreignProduct), { ...transaction(), customer_id: customer.id }]) {
          const result = (await sync(tokens.cashier, [row]).expect(201)).body.results[0];
          assert.equal(result.status, 'FAILED'); assert.equal(result.error.status_code, 404);
        }
        const local = await db.customers.create({ data: { tenant_id: tenant.id, name: 'Local' } });
        const row = { ...transaction(), customer_id: local.id };
        const result = (await sync(tokens.cashier, [row]).expect(201)).body.results[0];
        assert.equal(result.transaction.customer_id, local.id);
      });
      await t.test('M9-17-19 closed, foreign actor and wrong outlet sessions reject', async () => {
        const other = await db.outlets.create({ data: { tenant_id: tenant.id, name: 'Other' } });
        const session = await db.cashier_sessions.create({ data: { tenant_id: tenant.id, user_id: owner.id, outlet_id: other.id } });
        const wrong = { ...v1(), cashier_session_id: session.id };
        const mismatch = (await sync(tokens.owner, [wrong]).expect(201)).body.results[0];
        assert.equal(mismatch.error.error_code, 'SESSION_OUTLET_MISMATCH');
        const foreign = (await sync(tokens.cashier, [wrong]).expect(201)).body.results[0];
        assert.equal(foreign.error.error_code, 'INVALID_CASHIER_SESSION');
        await db.cashier_sessions.update({ where: { id: session.id }, data: { status: 'CLOSED', closed_at: new Date() } });
        const closed = (await sync(tokens.owner, [wrong]).expect(201)).body.results[0];
        assert.equal(closed.error.error_code, 'INVALID_CASHIER_SESSION');
      });
      await t.test('M9-21-23 V1 QRIS modifiers and notes retain snapshots', async () => {
        const group = await db.modifier_groups.create({ data: { tenant_id: tenant.id, name: 'Extra' } });
        const option = await db.modifier_options.create({ data: { tenant_id: tenant.id, modifier_group_id: group.id, name: 'Milk', price_delta: 50 } });
        await db.product_modifier_groups.create({ data: { tenant_id: tenant.id, product_id: product.id, modifier_group_id: group.id, selection_type: 'SINGLE', required: false } });
        const row = { ...v1(), payment: { method: 'QRIS' }, items: [{ product_id: product.id, quantity: 1, note: ' warm ', modifier_option_ids: [option.id] }] };
        const result = (await sync(tokens.cashier, [row]).expect(201)).body;
        assert.equal(result.synced, 1);
        const sale = result.results[0].transaction;
        assert.equal(sale.total, 150);
        assert.equal(sale.payments[0].amount_received, null); assert.equal(sale.payments[0].change_amount, null);
        const item = await db.transaction_items.findFirstOrThrow({ where: { transaction_id: sale.transaction_id }, include: { transaction_item_modifiers: true } });
        assert.equal(item.note_snapshot, 'warm'); assert.equal(item.effective_price_snapshot, 150n);
        assert.equal(item.transaction_item_modifiers[0].option_name_snapshot, 'Milk');
      });
      await t.test('M9-13/14 insufficient second product rolls back all writes and first deduction', async () => {
        const empty = await db.products.create({ data: { tenant_id: tenant.id, name: 'Empty', sku: randomUUID(), price: 100 } });
        await db.product_stocks.create({ data: { outlet_id: outlet.id, product_id: empty.id, stock: 0 } });
        const state = async () => ({ transactions: await db.transactions.count(), items: await db.transaction_items.count(), payments: await db.payments.count(), movements: await db.stock_movements.count(), stocks: await db.product_stocks.findMany({ orderBy: { id: 'asc' } }) });
        const before = await state();
        const row = transaction(); row.items.push({ product_id: empty.id, quantity: 1 }); row.payment.amount = 1000;
        const result = (await sync(tokens.cashier, [row]).expect(201)).body.results[0];
        assert.equal(result.error.error_code, 'INSUFFICIENT_STOCK'); assert.deepEqual(await state(), before);
      });
    } finally {
      await app?.close();
      await db?.$disconnect();
      await adminConnection.query('ROLLBACK');
      await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminConnection.end();
    }
  },
);
