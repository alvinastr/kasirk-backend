// Run with: npm run test:receipts
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
  process.env.RECEIPT_TEST_DATABASE_URL || process.env.DATABASE_URL;

test('Receipt HTTP API', { skip: !connectionString }, async (t) => {
  const schema = `receipts_${randomUUID().replaceAll('-', '')}`;
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
    const tenant = await db.tenants.create({
      data: { name: 'KasirKita Store', address: 'Jl. Utama 1' },
    });
    const otherTenant = await db.tenants.create({
      data: { name: 'Other Store' },
    });
    const outlet = await db.outlets.create({
      data: {
        tenant_id: tenant.id,
        name: 'Outlet Pusat',
        address: 'Lantai 1',
      },
    });
    const otherOutlet = await db.outlets.create({
      data: { tenant_id: tenant.id, name: 'Outlet Cabang' },
    });
    const owner = await db.users.create({
      data: {
        tenant_id: tenant.id,
        name: 'Owner',
        email: 'owner@receipt.test',
        password_hash: 'fixture',
        role: 'OWNER',
      },
    });
    const admin = await db.users.create({
      data: {
        tenant_id: tenant.id,
        name: 'Admin',
        email: 'admin@receipt.test',
        password_hash: 'fixture',
        role: 'ADMIN',
      },
    });
    const cashier = await db.users.create({
      data: {
        tenant_id: tenant.id,
        outlet_id: outlet.id,
        name: 'Kasir Satu',
        email: 'cashier@receipt.test',
        password_hash: 'fixture',
        role: 'CASHIER',
      },
    });
    const otherOutletCashier = await db.users.create({
      data: {
        tenant_id: tenant.id,
        outlet_id: otherOutlet.id,
        name: 'Kasir Cabang',
        email: 'branch-cashier@receipt.test',
        password_hash: 'fixture',
        role: 'CASHIER',
      },
    });
    const otherOwner = await db.users.create({
      data: {
        tenant_id: otherTenant.id,
        name: 'Other Owner',
        email: 'other-owner@receipt.test',
        password_hash: 'fixture',
        role: 'OWNER',
      },
    });
    const customer = await db.customers.create({
      data: {
        tenant_id: tenant.id,
        name: 'Siti',
        phone: '08123456789',
        email: 'siti@receipt.test',
      },
    });
    const product = await db.products.create({
      data: {
        tenant_id: tenant.id,
        name: 'Kopi Susu',
        sku: 'KOPI-SUSU',
        price: 100,
        cost: 50,
      },
    });
    await db.product_stocks.create({
      data: { outlet_id: outlet.id, product_id: product.id, stock: 10 },
    });

    const token = (user) =>
      jwt.sign({
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
      });
    const tokens = {
      owner: token(owner),
      admin: token(admin),
      cashier: token(cashier),
      otherOutletCashier: token(otherOutletCashier),
      otherOwner: token(otherOwner),
    };
    const auth = (requestBuilder, accessToken) =>
      requestBuilder.set('Authorization', `Bearer ${accessToken}`);
    const checkout = async (customerId, quantity, amount) =>
      auth(
        http.post('/transactions').send({
          client_transaction_id: randomUUID(),
          outlet_id: outlet.id,
          ...(customerId ? { customer_id: customerId } : {}),
          items: [{ product_id: product.id, quantity }],
          payment: { method: 'CASH', amount },
        }),
        tokens.cashier,
      ).expect(201);

    const withCustomer = await checkout(customer.id, 2, 500);
    const withoutCustomer = await checkout(undefined, 1, 100);

    await t.test('JWT and UUID validation protect the endpoint', async () => {
      await http
        .get(`/receipts/${withCustomer.body.transaction_id}`)
        .expect(401);
      await auth(http.get('/receipts/not-a-uuid'), tokens.owner).expect(400);
    });

    await t.test(
      'OWNER receives complete receipt data and change',
      async () => {
        const response = await auth(
          http.get(`/receipts/${withCustomer.body.transaction_id}`),
          tokens.owner,
        ).expect(200);
        const receipt = response.body;

        assert.equal(receipt.transaction_id, withCustomer.body.transaction_id);
        assert.equal(
          receipt.client_transaction_id,
          withCustomer.body.client_transaction_id,
        );
        assert.equal(receipt.status, 'COMPLETED');
        assert.deepEqual(receipt.store, {
          id: tenant.id,
          name: 'KasirKita Store',
          address: 'Jl. Utama 1',
        });
        assert.deepEqual(receipt.outlet, {
          id: outlet.id,
          name: 'Outlet Pusat',
          address: 'Lantai 1',
        });
        assert.deepEqual(receipt.cashier, {
          id: cashier.id,
          name: 'Kasir Satu',
        });
        assert.deepEqual(receipt.customer, {
          id: customer.id,
          name: 'Siti',
          phone: '08123456789',
          email: 'siti@receipt.test',
        });
        assert.deepEqual(receipt.items, [
          {
            item_id: receipt.items[0].item_id,
            product_id: product.id,
            product_name: 'Kopi Susu',
            sku: 'KOPI-SUSU',
            quantity: 2,
            unit_price: 100,
            subtotal: 200,
          },
        ]);
        assert.equal('unit_cost' in receipt.items[0], false);
        assert.deepEqual(receipt.totals, {
          subtotal: 200,
          discount: 0,
          tax: 0,
          total: 200,
        });
        assert.equal(receipt.payment.method, 'CASH');
        assert.equal(receipt.payment.status, 'PAID');
        assert.equal(receipt.payment.amount, 500);
        assert.equal(receipt.change, 300);
        assert.equal('tenant_id' in receipt, false);
        assert.equal('password_hash' in receipt.cashier, false);
      },
    );

    await t.test(
      'ADMIN and assigned CASHIER can view the receipt',
      async () => {
        for (const accessToken of [tokens.admin, tokens.cashier]) {
          const response = await auth(
            http.get(`/receipts/${withCustomer.body.transaction_id}`),
            accessToken,
          ).expect(200);
          assert.equal(
            response.body.transaction_id,
            withCustomer.body.transaction_id,
          );
        }
      },
    );

    await t.test(
      'receipt supports a transaction without customer',
      async () => {
        const response = await auth(
          http.get(`/receipts/${withoutCustomer.body.transaction_id}`),
          tokens.cashier,
        ).expect(200);
        assert.equal(response.body.customer, null);
        assert.equal(response.body.payment.amount, 100);
        assert.equal(response.body.totals.total, 100);
        assert.equal(response.body.change, 0);
      },
    );

    await t.test(
      'tenant and cashier outlet boundaries are enforced',
      async () => {
        await auth(
          http.get(`/receipts/${withCustomer.body.transaction_id}`),
          tokens.otherOwner,
        ).expect(404);
        await auth(
          http.get(`/receipts/${withCustomer.body.transaction_id}`),
          tokens.otherOutletCashier,
        ).expect(404);
      },
    );

    await t.test(
      'inactive outlet does not hide historical receipts',
      async () => {
        await db.outlets.update({
          where: { id: outlet.id },
          data: { is_active: false },
        });
        await auth(
          http.get(`/receipts/${withCustomer.body.transaction_id}`),
          tokens.owner,
        ).expect(200);
        await auth(
          http.get(`/receipts/${withCustomer.body.transaction_id}`),
          tokens.cashier,
        ).expect(200);
      },
    );
  } finally {
    await app?.close();
    await db?.$disconnect();
    await adminConnection.query('ROLLBACK');
    await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminConnection.end();
  }
});
