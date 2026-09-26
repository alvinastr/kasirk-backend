// Run with: npm run test:user-pin
// The test creates and drops only a random PostgreSQL schema.
require('reflect-metadata');

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
const bcrypt = require('bcrypt');
const { Client } = require('pg');
const request = require('supertest');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/prisma/prisma.service');

const connectionString =
  process.env.USER_PIN_TEST_DATABASE_URL || process.env.DATABASE_URL;

test('Auth V2 PIN enrollment', { skip: !connectionString }, async (t) => {
  const schema = `user_pin_${randomUUID().replaceAll('-', '')}`;
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
    const [tenantA, tenantB] = await Promise.all([
      db.tenants.create({ data: { name: 'Tenant A' } }),
      db.tenants.create({ data: { name: 'Tenant B' } }),
    ]);
    const createUser = (tenantId, role, email, overrides = {}) =>
      db.users.create({
        data: {
          tenant_id: tenantId,
          name: `${role} ${email}`,
          email,
          password_hash: 'legacy-password-hash',
          role,
          ...overrides,
        },
      });
    const futureLock = new Date(Date.now() + 15 * 60 * 1000);
    const [ownerA, adminA, cashierA, inactiveA, cashierB] = await Promise.all([
      createUser(tenantA.id, 'OWNER', 'owner-a@pin.test'),
      createUser(tenantA.id, 'ADMIN', 'admin-a@pin.test'),
      createUser(tenantA.id, 'CASHIER', 'cashier-a@pin.test', {
        pin_failed_attempts: 4,
        locked_until: futureLock,
      }),
      createUser(tenantA.id, 'CASHIER', 'inactive-a@pin.test', {
        is_active: false,
      }),
      createUser(tenantB.id, 'CASHIER', 'cashier-b@pin.test'),
    ]);
    const token = (user) =>
      jwt.sign({
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        outlet_id: user.outlet_id,
      });
    const tokens = {
      ownerA: token(ownerA),
      adminA: token(adminA),
      cashierA: token(cashierA),
    };
    const setPin = (targetId, authToken, pin) =>
      http
        .post(`/users/${targetId}/pin`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ pin });

    await t.test(
      'OWNER sets a hashed PIN and resets lockout state',
      async () => {
        await setPin(cashierA.id, tokens.ownerA, '123456').expect(204);

        const stored = await db.users.findUniqueOrThrow({
          where: { id: cashierA.id },
          select: {
            pin_hash: true,
            pin_changed_at: true,
            pin_failed_attempts: true,
            locked_until: true,
          },
        });
        assert.notEqual(stored.pin_hash, '123456');
        assert.equal(await bcrypt.compare('123456', stored.pin_hash), true);
        assert.ok(stored.pin_changed_at instanceof Date);
        assert.equal(stored.pin_failed_attempts, 0);
        assert.equal(stored.locked_until, null);
      },
    );

    await t.test('ADMIN can set a same-tenant user PIN', async () => {
      await setPin(cashierA.id, tokens.adminA, '654321').expect(204);
      const stored = await db.users.findUniqueOrThrow({
        where: { id: cashierA.id },
        select: { pin_hash: true },
      });
      assert.equal(await bcrypt.compare('654321', stored.pin_hash), true);
    });

    await t.test('CASHIER cannot set a PIN', async () => {
      const before = await db.users.findUniqueOrThrow({
        where: { id: cashierA.id },
        select: { pin_hash: true },
      });
      await setPin(cashierA.id, tokens.cashierA, '111222').expect(403);
      const after = await db.users.findUniqueOrThrow({
        where: { id: cashierA.id },
        select: { pin_hash: true },
      });
      assert.equal(after.pin_hash, before.pin_hash);
    });

    await t.test('cross-tenant and inactive users are rejected', async () => {
      for (const targetId of [cashierB.id, inactiveA.id, randomUUID()]) {
        const response = await setPin(targetId, tokens.ownerA, '123456').expect(
          404,
        );
        assert.equal(response.body.error_code, 'USER_NOT_FOUND');
        assert.equal(response.body.message, 'User not found');
      }
      const foreign = await db.users.findUniqueOrThrow({
        where: { id: cashierB.id },
        select: { pin_hash: true },
      });
      assert.equal(foreign.pin_hash, null);
    });

    await t.test('invalid PIN values are rejected', async () => {
      for (const pin of [
        '12345',
        '1234567',
        '12a456',
        '123 56',
        '',
        123456,
        null,
      ]) {
        await setPin(cashierA.id, tokens.ownerA, pin).expect(400);
      }
    });
  } finally {
    await app?.close();
    await db?.$disconnect();
    await adminConnection.query('SET search_path TO public');
    await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminConnection.end();
  }
});
