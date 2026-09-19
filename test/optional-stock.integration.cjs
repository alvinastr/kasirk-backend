// Run with: npm run test:optional-stock
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
  process.env.OPTIONAL_STOCK_TEST_DATABASE_URL || process.env.DATABASE_URL;

test(
  'Optional product stock tracking',
  { skip: !connectionString },
  async (t) => {
    const schema = `optional_stock_${randomUUID().replaceAll('-', '')}`;
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
      app.useGlobalPipes(
        new ValidationPipe({ transform: true, whitelist: true }),
      );
      await app.init();

      const http = request(app.getHttpServer());
      const jwt = testingModule.get(JwtService);
      const tenant = await db.tenants.create({
        data: { name: 'Optional Stock Tenant' },
      });
      const outlet = await db.outlets.create({
        data: { tenant_id: tenant.id, name: 'Main Outlet' },
      });
      const owner = await db.users.create({
        data: {
          tenant_id: tenant.id,
          name: 'Owner',
          email: 'owner@optional-stock.test',
          password_hash: 'fixture',
          role: 'OWNER',
        },
      });
      const token = jwt.sign({
        sub: owner.id,
        tenant_id: tenant.id,
        role: owner.role,
      });
      const auth = (requestBuilder) =>
        requestBuilder.set('Authorization', `Bearer ${token}`);
      const createProduct = (sku, trackStock) =>
        auth(http.post('/products')).send({
          name: sku,
          sku,
          price: 100,
          cost: 50,
          minimum_stock: 0,
          ...(trackStock === undefined ? {} : { track_stock: trackStock }),
        });
      const transaction = (items, clientTransactionId = randomUUID()) => ({
        client_transaction_id: clientTransactionId,
        outlet_id: outlet.id,
        items,
        payment: {
          method: 'CASH',
          amount: items.reduce((sum, item) => sum + item.quantity * 100, 0),
        },
      });
      const checkout = (body) => auth(http.post('/transactions')).send(body);
      const stock = async (productId) =>
        (
          await db.product_stocks.findUniqueOrThrow({
            where: {
              outlet_id_product_id: {
                outlet_id: outlet.id,
                product_id: productId,
              },
            },
          })
        ).stock;

      let tracked;
      let untracked;
      let lowTracked;

      await t.test(
        'product API defaults tracking to true, exposes it, and allows updates',
        async () => {
          tracked = (await createProduct('TRACKED')).body;
          untracked = (await createProduct('UNTRACKED', false)).body;
          lowTracked = (await createProduct('LOW-TRACKED')).body;

          assert.equal(tracked.track_stock, true);
          assert.equal(untracked.track_stock, false);
          assert.equal(lowTracked.track_stock, true);

          const list = await auth(http.get('/products')).expect(200);
          assert.equal(
            list.body.find((product) => product.id === tracked.id).track_stock,
            true,
          );
          assert.equal(
            list.body.find((product) => product.id === untracked.id)
              .track_stock,
            false,
          );

          const enabled = await auth(http.patch(`/products/${untracked.id}`))
            .send({ track_stock: true })
            .expect(200);
          assert.equal(enabled.body.track_stock, true);
          const disabled = await auth(http.patch(`/products/${untracked.id}`))
            .send({ track_stock: false })
            .expect(200);
          assert.equal(disabled.body.track_stock, false);

          await db.product_stocks.createMany({
            data: [
              { outlet_id: outlet.id, product_id: tracked.id, stock: 10 },
              { outlet_id: outlet.id, product_id: untracked.id, stock: 0 },
              { outlet_id: outlet.id, product_id: lowTracked.id, stock: 1 },
            ],
          });
        },
      );

      await t.test(
        'tracked product succeeds with stock and decrements inventory',
        async () => {
          const body = transaction([{ product_id: tracked.id, quantity: 2 }]);
          const response = await checkout(body).expect(201);
          assert.equal(response.body.status, 'COMPLETED');
          assert.equal(await stock(tracked.id), 8);
          assert.equal(
            await db.stock_movements.count({
              where: {
                reference_id: response.body.transaction_id,
                product_id: tracked.id,
                type: 'SALE',
              },
            }),
            1,
          );
        },
      );

      await t.test(
        'tracked product rejects insufficient stock without writes',
        async () => {
          const body = transaction([
            { product_id: lowTracked.id, quantity: 2 },
          ]);
          const response = await checkout(body).expect(409);
          assert.equal(response.body.error_code, 'INSUFFICIENT_STOCK');
          assert.equal(await stock(lowTracked.id), 1);
          assert.equal(
            await db.transactions.count({
              where: { client_transaction_id: body.client_transaction_id },
            }),
            0,
          );
          assert.equal(
            await db.stock_movements.count({
              where: { product_id: lowTracked.id },
            }),
            0,
          );
        },
      );

      await t.test(
        'untracked product succeeds at zero stock without stock mutation',
        async () => {
          const body = transaction([
            { product_id: untracked.id, quantity: 100 },
          ]);
          const response = await checkout(body).expect(201);
          assert.equal(response.body.status, 'COMPLETED');
          assert.equal(await stock(untracked.id), 0);
          assert.equal(
            await db.stock_movements.count({
              where: {
                reference_id: response.body.transaction_id,
                product_id: untracked.id,
              },
            }),
            0,
          );
        },
      );

      await t.test(
        'mixed cart decrements only the tracked product',
        async () => {
          const body = transaction([
            { product_id: tracked.id, quantity: 2 },
            { product_id: untracked.id, quantity: 5 },
          ]);
          const response = await checkout(body).expect(201);
          assert.equal(response.body.items.length, 2);
          assert.equal(await stock(tracked.id), 6);
          assert.equal(await stock(untracked.id), 0);
          const movements = await db.stock_movements.findMany({
            where: { reference_id: response.body.transaction_id },
          });
          assert.equal(movements.length, 1);
          assert.equal(movements[0].product_id, tracked.id);
          assert.equal(movements[0].quantity, -2);
        },
      );

      await t.test(
        'insufficient tracked item rolls back an entire mixed transaction',
        async () => {
          const body = transaction([
            { product_id: lowTracked.id, quantity: 2 },
            { product_id: untracked.id, quantity: 5 },
          ]);
          const transactionCount = await db.transactions.count();
          const itemCount = await db.transaction_items.count();
          const movementCount = await db.stock_movements.count();

          const response = await checkout(body).expect(409);
          assert.equal(response.body.error_code, 'INSUFFICIENT_STOCK');
          assert.equal(await db.transactions.count(), transactionCount);
          assert.equal(await db.transaction_items.count(), itemCount);
          assert.equal(await db.stock_movements.count(), movementCount);
          assert.equal(await stock(lowTracked.id), 1);
          assert.equal(await stock(untracked.id), 0);
        },
      );

      await t.test(
        'offline sync supports untracked stock and replay is idempotent',
        async () => {
          const body = transaction([
            { product_id: tracked.id, quantity: 1 },
            { product_id: untracked.id, quantity: 3 },
          ]);
          const first = await auth(http.post('/sync/transactions'))
            .send({ transactions: [body] })
            .expect(201);
          assert.equal(first.body.synced, 1);
          assert.equal(first.body.failed, 0);
          assert.equal(first.body.results[0].status, 'SYNCED');
          const transactionId =
            first.body.results[0].transaction.transaction_id;
          assert.equal(await stock(tracked.id), 5);
          assert.equal(await stock(untracked.id), 0);

          const replay = await auth(http.post('/sync/transactions'))
            .send({ transactions: [body] })
            .expect(201);
          assert.equal(
            replay.body.results[0].transaction.transaction_id,
            transactionId,
          );
          assert.equal(
            await db.transactions.count({
              where: { client_transaction_id: body.client_transaction_id },
            }),
            1,
          );
          assert.equal(
            await db.stock_movements.count({
              where: { reference_id: transactionId, type: 'SALE' },
            }),
            1,
          );
          assert.equal(await stock(tracked.id), 5);
          assert.equal(await stock(untracked.id), 0);
        },
      );

      await t.test(
        'manual adjustment is rejected when stock tracking is disabled',
        async () => {
          const adjustments = await db.stock_adjustments.count();
          const response = await auth(http.post('/stock/adjustment'))
            .send({
              outlet_id: outlet.id,
              product_id: untracked.id,
              adjustment_type: 'ADD',
              quantity: 1,
              reason: 'Must stay disabled',
            })
            .expect(409);
          assert.equal(response.body.error_code, 'STOCK_TRACKING_DISABLED');
          assert.equal(await db.stock_adjustments.count(), adjustments);
          assert.equal(await stock(untracked.id), 0);
        },
      );
    } finally {
      await app?.close();
      await db?.$disconnect();
      await adminConnection.query('ROLLBACK');
      await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminConnection.end();
    }
  },
);
