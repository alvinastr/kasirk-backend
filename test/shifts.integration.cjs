// Run with: npm run test:shifts
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
  process.env.SHIFT_TEST_DATABASE_URL || process.env.DATABASE_URL;

test('Shift HTTP API', { skip: !connectionString }, async (t) => {
  const schema = `shifts_${randomUUID().replaceAll('-', '')}`;
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
      data: { name: 'Shift Tenant' },
    });
    const otherTenant = await db.tenants.create({
      data: { name: 'Other Shift Tenant' },
    });
    const outlet = await db.outlets.create({
      data: { tenant_id: tenant.id, name: 'Main Outlet' },
    });
    const secondOutlet = await db.outlets.create({
      data: { tenant_id: tenant.id, name: 'Second Outlet' },
    });
    const foreignOutlet = await db.outlets.create({
      data: { tenant_id: otherTenant.id, name: 'Foreign Outlet' },
    });
    const owner = await db.users.create({
      data: {
        tenant_id: tenant.id,
        name: 'Owner',
        email: 'owner@shift.test',
        password_hash: 'fixture',
        role: 'OWNER',
      },
    });
    const admin = await db.users.create({
      data: {
        tenant_id: tenant.id,
        name: 'Admin',
        email: 'admin@shift.test',
        password_hash: 'fixture',
        role: 'ADMIN',
      },
    });
    const cashier = await db.users.create({
      data: {
        tenant_id: tenant.id,
        outlet_id: outlet.id,
        name: 'Cashier',
        email: 'cashier@shift.test',
        password_hash: 'fixture',
        role: 'CASHIER',
      },
    });
    const otherOwner = await db.users.create({
      data: {
        tenant_id: otherTenant.id,
        name: 'Other Owner',
        email: 'other-owner@shift.test',
        password_hash: 'fixture',
        role: 'OWNER',
      },
    });
    const product = await db.products.create({
      data: {
        tenant_id: tenant.id,
        name: 'Shift Product',
        sku: 'SHIFT-PRODUCT',
        price: 100,
        cost: 50,
      },
    });
    await db.product_stocks.create({
      data: { outlet_id: outlet.id, product_id: product.id, stock: 20 },
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
      otherOwner: token(otherOwner),
    };
    const auth = (requestBuilder, accessToken) =>
      requestBuilder.set('Authorization', `Bearer ${accessToken}`);

    await t.test('JWT and DTO validation protect opening a shift', async () => {
      await http
        .post('/shifts/open')
        .send({ outlet_id: outlet.id, opening_cash: 0 })
        .expect(401);
      await auth(
        http
          .post('/shifts/open')
          .send({ outlet_id: outlet.id, opening_cash: -1 }),
        tokens.cashier,
      ).expect(400);
    });

    await t.test('outlet and tenant boundaries are enforced', async () => {
      await auth(
        http
          .post('/shifts/open')
          .send({ outlet_id: secondOutlet.id, opening_cash: 0 }),
        tokens.cashier,
      ).expect(403);
      await auth(
        http
          .post('/shifts/open')
          .send({ outlet_id: foreignOutlet.id, opening_cash: 0 }),
        tokens.owner,
      ).expect(404);
    });

    let ownerShiftId;
    await t.test(
      'OWNER can open and ADMIN can close a tenant shift',
      async () => {
        const opened = await auth(
          http
            .post('/shifts/open')
            .send({ outlet_id: secondOutlet.id, opening_cash: 50 }),
          tokens.owner,
        ).expect(201);
        ownerShiftId = opened.body.shift_id;
        assert.equal(opened.body.user_id, owner.id);
        assert.equal(opened.body.status, 'OPEN');

        await auth(
          http.post(`/shifts/${ownerShiftId}/close`).send({ closing_cash: 50 }),
          tokens.cashier,
        ).expect(403);

        const closed = await auth(
          http.post(`/shifts/${ownerShiftId}/close`).send({ closing_cash: 50 }),
          tokens.admin,
        ).expect(201);
        assert.equal(closed.body.status, 'CLOSED');
        assert.equal(closed.body.expected_cash, 50);
        assert.equal(closed.body.difference, 0);
      },
    );

    let shiftId;
    await t.test(
      'CASHIER opens and reads only their active shift',
      async () => {
        await auth(http.get('/shifts/current'), tokens.cashier).expect(404);
        const opened = await auth(
          http
            .post('/shifts/open')
            .send({ outlet_id: outlet.id, opening_cash: 100 }),
          tokens.cashier,
        ).expect(201);
        shiftId = opened.body.shift_id;
        assert.equal(opened.body.outlet_id, outlet.id);
        assert.equal(opened.body.user_id, cashier.id);
        assert.equal(opened.body.opening_cash, 100);
        assert.equal(opened.body.closing_cash, null);
        assert.equal(opened.body.status, 'OPEN');

        const current = await auth(
          http.get('/shifts/current'),
          tokens.cashier,
        ).expect(200);
        assert.equal(current.body.shift_id, shiftId);

        const duplicate = await auth(
          http
            .post('/shifts/open')
            .send({ outlet_id: outlet.id, opening_cash: 0 }),
          tokens.cashier,
        ).expect(409);
        assert.equal(duplicate.body.error_code, 'SHIFT_ALREADY_OPEN');
      },
    );

    await t.test(
      'only eligible completed CASH sales affect expected cash',
      async () => {
        const checkout = await auth(
          http.post('/transactions').send({
            client_transaction_id: randomUUID(),
            outlet_id: outlet.id,
            items: [{ product_id: product.id, quantity: 2 }],
            payment: { method: 'CASH', amount: 500 },
          }),
          tokens.cashier,
        ).expect(201);
        assert.equal(checkout.body.total, 200);

        const createExcludedTransaction = async ({
          status,
          method,
          userId = cashier.id,
          amount = 900,
        }) => {
          const transaction = await db.transactions.create({
            data: {
              tenant_id: tenant.id,
              outlet_id: outlet.id,
              user_id: userId,
              client_transaction_id: randomUUID(),
              status,
              subtotal: amount,
              total: amount,
            },
          });
          await db.payments.create({
            data: {
              tenant_id: tenant.id,
              transaction_id: transaction.id,
              method,
              status: 'PAID',
              amount,
              paid_at: new Date(),
            },
          });
        };
        await createExcludedTransaction({ status: 'PENDING', method: 'CASH' });
        await createExcludedTransaction({
          status: 'COMPLETED',
          method: 'QRIS',
        });
        await createExcludedTransaction({
          status: 'COMPLETED',
          method: 'CASH',
          userId: owner.id,
        });

        await auth(
          http.post(`/shifts/${shiftId}/close`).send({ closing_cash: 350 }),
          tokens.otherOwner,
        ).expect(404);

        const closed = await auth(
          http.post(`/shifts/${shiftId}/close`).send({ closing_cash: 350 }),
          tokens.cashier,
        ).expect(201);
        assert.equal(closed.body.status, 'CLOSED');
        assert.equal(closed.body.opening_cash, 100);
        assert.equal(closed.body.closing_cash, 350);
        assert.equal(closed.body.expected_cash, 300);
        assert.equal(closed.body.difference, 50);
        assert.ok(closed.body.closed_at);

        const persisted = await db.cashier_sessions.findUnique({
          where: { id: shiftId },
        });
        assert.equal(persisted.expected_cash, 300n);
        assert.equal(persisted.difference, 50n);

        await auth(http.get('/shifts/current'), tokens.cashier).expect(404);
        const repeat = await auth(
          http.post(`/shifts/${shiftId}/close`).send({ closing_cash: 350 }),
          tokens.cashier,
        ).expect(409);
        assert.equal(repeat.body.error_code, 'SHIFT_ALREADY_CLOSED');
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
