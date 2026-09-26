// Run with: npm run test:pin-login
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
  process.env.PIN_LOGIN_TEST_DATABASE_URL || process.env.DATABASE_URL;

test('Auth V2 PIN login', { skip: !connectionString }, async (t) => {
  const previousThreshold = process.env.PIN_MAX_FAILED_ATTEMPTS;
  const previousLockMinutes = process.env.PIN_LOCK_DURATION_MINUTES;
  process.env.PIN_MAX_FAILED_ATTEMPTS = '3';
  process.env.PIN_LOCK_DURATION_MINUTES = '15';

  const schema = `pin_login_${randomUUID().replaceAll('-', '')}`;
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
    const pin = '123456';
    const pinHash = await bcrypt.hash(pin, 4);
    const deviceId = randomUUID();
    const [tenantA, tenantB] = await Promise.all([
      db.tenants.create({ data: { name: 'Tenant A' } }),
      db.tenants.create({ data: { name: 'Tenant B' } }),
    ]);
    const createUser = (tenantId, email, overrides = {}) =>
      db.users.create({
        data: {
          tenant_id: tenantId,
          name: email,
          email,
          password_hash: 'legacy-password-hash',
          role: 'CASHIER',
          pin_hash: pinHash,
          ...overrides,
        },
      });
    const [
      activeUser,
      wrongPinUser,
      lockoutUser,
      inactiveUser,
      noPinUser,
      foreignUser,
    ] = await Promise.all([
      createUser(tenantA.id, 'active@pin-login.test', {
        pin_failed_attempts: 2,
      }),
      createUser(tenantA.id, 'wrong@pin-login.test'),
      createUser(tenantA.id, 'lockout@pin-login.test'),
      createUser(tenantA.id, 'inactive@pin-login.test', {
        is_active: false,
      }),
      createUser(tenantA.id, 'no-pin@pin-login.test', { pin_hash: null }),
      createUser(tenantB.id, 'foreign@pin-login.test'),
    ]);
    const login = (tenantId, userId, submittedPin) =>
      http.post('/auth/v2/pin/login').send({
        tenant_id: tenantId,
        user_id: userId,
        pin: submittedPin,
        device_id: deviceId,
        device_name: 'PIN Login Test Device',
      });

    await t.test('correct PIN issues the existing JWT payload', async () => {
      const response = await login(tenantA.id, activeUser.id, pin).expect(200);
      assert.equal(typeof response.body.access_token, 'string');
      assert.equal(typeof response.body.refresh_token, 'string');
      assert.equal(response.body.expires_in, 86_400);
      const payload = jwt.verify(response.body.access_token);
      assert.equal(payload.sub, activeUser.id);
      assert.equal(payload.tenant_id, tenantA.id);
      assert.equal(payload.role, 'CASHIER');
      assert.equal(payload.outlet_id, null);

      const stored = await db.users.findUniqueOrThrow({
        where: { id: activeUser.id },
        select: { pin_failed_attempts: true, locked_until: true },
      });
      assert.equal(stored.pin_failed_attempts, 0);
      assert.equal(stored.locked_until, null);
    });

    await t.test('wrong PIN is rejected and increments attempts', async () => {
      const response = await login(
        tenantA.id,
        wrongPinUser.id,
        '999999',
      ).expect(401);
      assert.equal(response.body.error_code, 'INVALID_CREDENTIALS');
      const stored = await db.users.findUniqueOrThrow({
        where: { id: wrongPinUser.id },
        select: { pin_failed_attempts: true, locked_until: true },
      });
      assert.equal(stored.pin_failed_attempts, 1);
      assert.equal(stored.locked_until, null);
    });

    await t.test('inactive user is rejected', async () => {
      const response = await login(tenantA.id, inactiveUser.id, pin).expect(
        401,
      );
      assert.equal(response.body.error_code, 'INVALID_CREDENTIALS');
    });

    await t.test('tenant isolation rejects a foreign user', async () => {
      const response = await login(tenantA.id, foreignUser.id, pin).expect(401);
      assert.equal(response.body.error_code, 'INVALID_CREDENTIALS');
      const stored = await db.users.findUniqueOrThrow({
        where: { id: foreignUser.id },
        select: { pin_failed_attempts: true },
      });
      assert.equal(stored.pin_failed_attempts, 0);
    });

    await t.test('user without a PIN is rejected', async () => {
      const response = await login(tenantA.id, noPinUser.id, pin).expect(401);
      assert.equal(response.body.error_code, 'INVALID_CREDENTIALS');
    });

    await t.test('account locks at the configured threshold', async () => {
      await login(tenantA.id, lockoutUser.id, '999999').expect(401);
      await login(tenantA.id, lockoutUser.id, '999999').expect(401);
      const thresholdResponse = await login(
        tenantA.id,
        lockoutUser.id,
        '999999',
      ).expect(423);
      assert.equal(thresholdResponse.body.error_code, 'PIN_LOCKED');
      assert.ok(thresholdResponse.body.retry_after_seconds > 0);

      const stored = await db.users.findUniqueOrThrow({
        where: { id: lockoutUser.id },
        select: { pin_failed_attempts: true, locked_until: true },
      });
      assert.equal(stored.pin_failed_attempts, 3);
      assert.ok(stored.locked_until > new Date());

      const lockedResponse = await login(
        tenantA.id,
        lockoutUser.id,
        pin,
      ).expect(423);
      assert.equal(lockedResponse.body.error_code, 'PIN_LOCKED');
    });

    await t.test('request UUID and PIN formats are validated', async () => {
      for (const body of [
        { tenant_id: 'invalid', user_id: activeUser.id, pin },
        { tenant_id: tenantA.id, user_id: 'invalid', pin },
        { tenant_id: tenantA.id, user_id: activeUser.id, pin: '12345' },
        { tenant_id: tenantA.id, user_id: activeUser.id, pin: 123456 },
      ]) {
        await http.post('/auth/v2/pin/login').send(body).expect(400);
      }
    });
  } finally {
    await app?.close();
    await db?.$disconnect();
    await adminConnection.query('SET search_path TO public');
    await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminConnection.end();

    if (previousThreshold === undefined) {
      delete process.env.PIN_MAX_FAILED_ATTEMPTS;
    } else {
      process.env.PIN_MAX_FAILED_ATTEMPTS = previousThreshold;
    }
    if (previousLockMinutes === undefined) {
      delete process.env.PIN_LOCK_DURATION_MINUTES;
    } else {
      process.env.PIN_LOCK_DURATION_MINUTES = previousLockMinutes;
    }
  }
});
