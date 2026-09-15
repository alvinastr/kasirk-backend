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

      await t.test('JWT, nested DTO, and open shift are required', async () => {
        await http
          .post('/sync/transactions')
          .send({ transactions: [] })
          .expect(401);
        await sync(tokens.owner, []).expect(400);

        const input = transaction();
        const response = await sync(tokens.cashierWithoutShift, [input]).expect(
          403,
        );
        assert.equal(response.body.error_code, 'OPEN_SHIFT_REQUIRED');
        assert.equal(
          await db.transactions.count({
            where: { client_transaction_id: input.client_transaction_id },
          }),
          0,
        );
      });

      await auth(
        http
          .post('/shifts/open')
          .send({ outlet_id: outlet.id, opening_cash: 0 }),
        tokens.cashier,
      ).expect(201);

      let firstInput;
      let firstTransactionId;
      await t.test(
        'successful sync uses the existing checkout flow',
        async () => {
          firstInput = transaction(randomUUID(), 2);
          const response = await sync(tokens.cashier, [firstInput]).expect(201);
          assert.equal(response.body.total, 1);
          assert.equal(response.body.synced, 1);
          assert.equal(response.body.failed, 0);
          assert.equal(response.body.results[0].status, 'SYNCED');

          const synced = response.body.results[0].transaction;
          firstTransactionId = synced.transaction_id;
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
    } finally {
      await app?.close();
      await db?.$disconnect();
      await adminConnection.query('ROLLBACK');
      await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminConnection.end();
    }
  },
);
