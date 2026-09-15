// Run with: npm run test:customers
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
  process.env.CUSTOMER_TEST_DATABASE_URL || process.env.DATABASE_URL;

test(
  'Customer HTTP API and transaction relation',
  { skip: !connectionString },
  async (t) => {
    const schema = `customers_${randomUUID().replaceAll('-', '')}`;
    const admin = new Client({ connectionString });
    await admin.connect();
    let db;
    let app;

    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.query(`SET search_path TO "${schema}"`);

      const migrationsDirectory = join(__dirname, '../prisma/migrations');
      for (const name of readdirSync(migrationsDirectory).sort()) {
        const migrationFile = join(migrationsDirectory, name, 'migration.sql');
        if (!existsSync(migrationFile)) continue;
        const sql = readFileSync(migrationFile, 'utf8').replaceAll(
          '"public"',
          `"${schema}"`,
        );
        await admin.query(sql);
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
      const tenantA = await db.tenants.create({ data: { name: 'Tenant A' } });
      const tenantB = await db.tenants.create({ data: { name: 'Tenant B' } });
      const outletA = await db.outlets.create({
        data: { tenant_id: tenantA.id, name: 'Outlet A' },
      });
      const owner = await db.users.create({
        data: {
          tenant_id: tenantA.id,
          name: 'Owner',
          email: 'owner@customer.test',
          password_hash: 'fixture',
          role: 'OWNER',
        },
      });
      const adminUser = await db.users.create({
        data: {
          tenant_id: tenantA.id,
          name: 'Admin',
          email: 'admin@customer.test',
          password_hash: 'fixture',
          role: 'ADMIN',
        },
      });
      const cashier = await db.users.create({
        data: {
          tenant_id: tenantA.id,
          outlet_id: outletA.id,
          name: 'Cashier',
          email: 'cashier@customer.test',
          password_hash: 'fixture',
          role: 'CASHIER',
        },
      });
      const otherOwner = await db.users.create({
        data: {
          tenant_id: tenantB.id,
          name: 'Other Owner',
          email: 'owner@other-customer.test',
          password_hash: 'fixture',
          role: 'OWNER',
        },
      });
      const product = await db.products.create({
        data: {
          tenant_id: tenantA.id,
          name: 'Product',
          sku: 'CUSTOMER-TEST-PRODUCT',
          price: 100,
          cost: 50,
        },
      });
      await db.product_stocks.create({
        data: { outlet_id: outletA.id, product_id: product.id, stock: 10 },
      });

      const token = (user) =>
        jwt.sign({
          sub: user.id,
          tenant_id: user.tenant_id,
          role: user.role,
        });
      const ownerToken = token(owner);
      const adminToken = token(adminUser);
      const cashierToken = token(cashier);
      const otherToken = token(otherOwner);
      const auth = (requestBuilder, accessToken) =>
        requestBuilder.set('Authorization', `Bearer ${accessToken}`);
      let ownerCustomer;
      let adminCustomer;

      await t.test(
        'OWNER and ADMIN create tenant-scoped customers',
        async () => {
          const ownerResponse = await auth(
            http.post('/customers').send({
              name: '  Siti  ',
              phone: '08123456789',
              email: 'SITI@EXAMPLE.TEST',
            }),
            ownerToken,
          ).expect(201);
          ownerCustomer = ownerResponse.body;
          assert.equal(ownerCustomer.name, 'Siti');
          assert.equal(ownerCustomer.email, 'siti@example.test');
          assert.equal('tenant_id' in ownerCustomer, false);

          const adminResponse = await auth(
            http.post('/customers').send({ name: 'Admin Customer' }),
            adminToken,
          ).expect(201);
          adminCustomer = adminResponse.body;

          await auth(
            http.post('/customers').send({
              name: 'Duplicate Phone',
              phone: '08123456789',
            }),
            adminToken,
          ).expect(409);
        },
      );

      await t.test(
        'CASHIER cannot create but can list and read customers',
        async () => {
          await auth(
            http.post('/customers').send({ name: 'Denied' }),
            cashierToken,
          ).expect(403);

          const list = await auth(http.get('/customers'), cashierToken).expect(
            200,
          );
          assert.ok(
            list.body.some((customer) => customer.id === ownerCustomer.id),
          );
          const detail = await auth(
            http.get(`/customers/${ownerCustomer.id}`),
            cashierToken,
          ).expect(200);
          assert.equal(detail.body.id, ownerCustomer.id);
        },
      );

      await t.test(
        'another tenant cannot read or reuse a customer ID',
        async () => {
          await auth(
            http.get(`/customers/${ownerCustomer.id}`),
            otherToken,
          ).expect(404);
          await auth(
            http.patch(`/customers/${ownerCustomer.id}`).send({ name: 'Nope' }),
            otherToken,
          ).expect(404);

          const samePhoneOtherTenant = await auth(
            http.post('/customers').send({
              name: 'Other Tenant Customer',
              phone: '08123456789',
            }),
            otherToken,
          ).expect(201);
          assert.notEqual(samePhoneOtherTenant.body.id, ownerCustomer.id);
        },
      );

      const transactionBody = (customerId) => ({
        client_transaction_id: randomUUID(),
        outlet_id: outletA.id,
        ...(customerId ? { customer_id: customerId } : {}),
        items: [{ product_id: product.id, quantity: 1 }],
        payment: { method: 'CASH', amount: 100 },
      });

      await t.test(
        'transactions work with and without a customer',
        async () => {
          const withCustomerPayload = transactionBody(ownerCustomer.id);
          const withCustomer = await auth(
            http.post('/transactions').send(withCustomerPayload),
            cashierToken,
          ).expect(201);
          assert.equal(withCustomer.body.customer_id, ownerCustomer.id);

          const replay = await auth(
            http.post('/transactions').send(withCustomerPayload),
            cashierToken,
          ).expect(201);
          assert.equal(
            replay.body.transaction_id,
            withCustomer.body.transaction_id,
          );
          await auth(
            http
              .post('/transactions')
              .send({ ...withCustomerPayload, customer_id: adminCustomer.id }),
            cashierToken,
          ).expect(409);

          const withoutCustomer = await auth(
            http.post('/transactions').send(transactionBody()),
            cashierToken,
          ).expect(201);
          assert.equal(withoutCustomer.body.customer_id, null);

          const stored = await db.transactions.findMany({
            where: {
              tenant_id: tenantA.id,
              id: {
                in: [
                  withCustomer.body.transaction_id,
                  withoutCustomer.body.transaction_id,
                ],
              },
            },
            orderBy: { customer_id: 'desc' },
          });
          assert.equal(stored.length, 2);
          assert.deepEqual(
            new Set(stored.map((transaction) => transaction.customer_id)),
            new Set([ownerCustomer.id, null]),
          );
        },
      );

      await t.test(
        'foreign customer cannot be attached to tenant transaction',
        async () => {
          const foreignCustomer = await db.customers.create({
            data: { tenant_id: tenantB.id, name: 'Foreign Customer' },
          });
          const stockBefore = await db.product_stocks.findFirstOrThrow({
            where: { outlet_id: outletA.id, product_id: product.id },
          });
          await auth(
            http
              .post('/transactions')
              .send(transactionBody(foreignCustomer.id)),
            ownerToken,
          ).expect(404);
          const stockAfter = await db.product_stocks.findFirstOrThrow({
            where: { outlet_id: outletA.id, product_id: product.id },
          });
          assert.equal(stockAfter.stock, stockBefore.stock);
        },
      );

      await t.test(
        'history contains only completed customer transactions',
        async () => {
          await db.transactions.create({
            data: {
              tenant_id: tenantA.id,
              outlet_id: outletA.id,
              user_id: owner.id,
              customer_id: ownerCustomer.id,
              client_transaction_id: randomUUID(),
              status: 'PENDING',
            },
          });

          await auth(
            http.get(`/customers/${ownerCustomer.id}/transactions`),
            cashierToken,
          ).expect(403);
          const history = await auth(
            http.get(`/customers/${ownerCustomer.id}/transactions`),
            adminToken,
          ).expect(200);
          assert.equal(history.body.customer_id, ownerCustomer.id);
          assert.equal(history.body.total_transactions, 1);
          assert.equal(history.body.total_spending, 100);
          assert.equal(history.body.transactions.length, 1);
          assert.equal(history.body.transactions[0].total, 100);
        },
      );

      await t.test('OWNER/ADMIN update and delete within tenant', async () => {
        const updated = await auth(
          http
            .patch(`/customers/${ownerCustomer.id}`)
            .send({ phone: null, email: 'NEW@EXAMPLE.TEST' }),
          adminToken,
        ).expect(200);
        assert.equal(updated.body.phone, null);
        assert.equal(updated.body.email, 'new@example.test');

        await auth(
          http.delete(`/customers/${ownerCustomer.id}`),
          ownerToken,
        ).expect(409);
        await auth(
          http.delete(`/customers/${adminCustomer.id}`),
          adminToken,
        ).expect(200);
        await auth(
          http.get(`/customers/${adminCustomer.id}`),
          ownerToken,
        ).expect(404);
      });

      assert.equal(
        await db.product_stocks
          .findFirstOrThrow({
            where: { outlet_id: outletA.id, product_id: product.id },
          })
          .then((stock) => stock.stock),
        8,
      );
    } finally {
      await app?.close();
      await db?.$disconnect();
      await admin.query('ROLLBACK');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
