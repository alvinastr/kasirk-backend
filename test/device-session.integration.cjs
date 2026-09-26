// Run with: npm run test:device-session
// The test creates and drops only a random PostgreSQL schema.
require('reflect-metadata');

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
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
  process.env.DEVICE_SESSION_TEST_DATABASE_URL || process.env.DATABASE_URL;
const hashToken = (token) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

test('Auth V2 device sessions', { skip: !connectionString }, async (t) => {
  const previousRefreshDays = process.env.REFRESH_TOKEN_TTL_DAYS;
  process.env.REFRESH_TOKEN_TTL_DAYS = '30';

  const schema = `device_session_${randomUUID().replaceAll('-', '')}`;
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
    const [tenantA, tenantB, tenantInactive] = await Promise.all([
      db.tenants.create({ data: { name: 'Tenant A' } }),
      db.tenants.create({ data: { name: 'Tenant B' } }),
      db.tenants.create({ data: { name: 'Inactive Tenant' } }),
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
    const [userA, userB, inactiveUser, inactiveTenantUser] = await Promise.all([
      createUser(tenantA.id, 'a@session.test'),
      createUser(tenantB.id, 'b@session.test'),
      createUser(tenantA.id, 'inactive@session.test'),
      createUser(tenantInactive.id, 'inactive-tenant@session.test'),
    ]);
    const deviceId = randomUUID();
    const deviceName = 'Kasir Test Device';
    const login = () =>
      http.post('/auth/v2/pin/login').send({
        tenant_id: tenantA.id,
        user_id: userA.id,
        pin,
        device_id: deviceId,
        device_name: deviceName,
      });
    const refresh = (refreshToken) =>
      http.post('/auth/v2/refresh').send({ refresh_token: refreshToken });
    const logout = (refreshToken) =>
      http.post('/auth/v2/logout').send({ refresh_token: refreshToken });
    const createSession = async ({
      tenant,
      user,
      status = 'ACTIVE',
      createdAt = new Date(),
      expiresAt = new Date(Date.now() + 60 * 60 * 1000),
    }) => {
      const rawToken = `${randomUUID()}${randomUUID()}`.replaceAll('-', '');
      const revokedAt = status === 'REVOKED' ? new Date() : null;
      const session = await db.device_sessions.create({
        data: {
          tenant_id: tenant.id,
          user_id: user.id,
          device_id: randomUUID(),
          device_name: 'Fixture Device',
          refresh_token_hash: hashToken(rawToken),
          status,
          created_at: createdAt,
          last_used_at: createdAt,
          expires_at: expiresAt,
          revoked_at: revokedAt,
        },
      });
      return { rawToken, session };
    };

    let firstRefreshToken;
    let rotatedRefreshToken;

    await t.test('PIN login creates a hashed device session', async () => {
      const response = await login().expect(200);
      assert.equal(typeof response.body.access_token, 'string');
      assert.equal(typeof response.body.refresh_token, 'string');
      assert.equal(response.body.expires_in, 86_400);
      firstRefreshToken = response.body.refresh_token;

      const sessions = await db.device_sessions.findMany({
        where: { tenant_id: tenantA.id, user_id: userA.id },
      });
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].status, 'ACTIVE');
      assert.equal(sessions[0].device_id, deviceId);
      assert.equal(sessions[0].device_name, deviceName);
      assert.notEqual(sessions[0].refresh_token_hash, firstRefreshToken);
      assert.equal(
        sessions[0].refresh_token_hash,
        hashToken(firstRefreshToken),
      );
      assert.ok(sessions[0].expires_at > new Date());
    });

    await t.test('valid refresh rotates the session', async () => {
      const response = await refresh(firstRefreshToken).expect(200);
      rotatedRefreshToken = response.body.refresh_token;
      assert.notEqual(rotatedRefreshToken, firstRefreshToken);
      assert.equal(response.body.expires_in, 86_400);
      const payload = jwt.verify(response.body.access_token);
      assert.equal(payload.sub, userA.id);
      assert.equal(payload.tenant_id, tenantA.id);

      const oldSession = await db.device_sessions.findUniqueOrThrow({
        where: { refresh_token_hash: hashToken(firstRefreshToken) },
      });
      assert.equal(oldSession.status, 'REVOKED');
      assert.ok(oldSession.revoked_at instanceof Date);
      assert.ok(oldSession.rotated_at instanceof Date);

      const newSession = await db.device_sessions.findUniqueOrThrow({
        where: { refresh_token_hash: hashToken(rotatedRefreshToken) },
      });
      assert.equal(newSession.status, 'ACTIVE');
      assert.equal(newSession.tenant_id, tenantA.id);
      assert.equal(newSession.user_id, userA.id);
      assert.equal(newSession.device_id, deviceId);
    });

    await t.test('old rotated token is rejected', async () => {
      const response = await refresh(firstRefreshToken).expect(401);
      assert.equal(response.body.error_code, 'INVALID_REFRESH_TOKEN');
    });

    await t.test('expired session is rejected and revoked', async () => {
      const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const expiresAt = new Date(Date.now() - 60 * 60 * 1000);
      const fixture = await createSession({
        tenant: tenantA,
        user: userA,
        createdAt,
        expiresAt,
      });
      const response = await refresh(fixture.rawToken).expect(401);
      assert.equal(response.body.error_code, 'INVALID_REFRESH_TOKEN');
      const stored = await db.device_sessions.findUniqueOrThrow({
        where: { id: fixture.session.id },
      });
      assert.equal(stored.status, 'REVOKED');
      assert.ok(stored.revoked_at instanceof Date);
    });

    await t.test('revoked session is rejected', async () => {
      const fixture = await createSession({
        tenant: tenantA,
        user: userA,
        status: 'REVOKED',
      });
      const response = await refresh(fixture.rawToken).expect(401);
      assert.equal(response.body.error_code, 'INVALID_REFRESH_TOKEN');
    });

    await t.test('inactive user is rejected', async () => {
      const fixture = await createSession({
        tenant: tenantA,
        user: inactiveUser,
      });
      await db.users.update({
        where: { id: inactiveUser.id },
        data: { is_active: false },
      });
      const response = await refresh(fixture.rawToken).expect(401);
      assert.equal(response.body.error_code, 'INVALID_REFRESH_TOKEN');
    });

    await t.test('inactive tenant is rejected', async () => {
      const fixture = await createSession({
        tenant: tenantInactive,
        user: inactiveTenantUser,
      });
      await db.tenants.update({
        where: { id: tenantInactive.id },
        data: { is_active: false },
      });
      const response = await refresh(fixture.rawToken).expect(401);
      assert.equal(response.body.error_code, 'INVALID_REFRESH_TOKEN');
    });

    await t.test('logout revokes a session and is idempotent', async () => {
      await logout(rotatedRefreshToken).expect(204);
      const session = await db.device_sessions.findUniqueOrThrow({
        where: { refresh_token_hash: hashToken(rotatedRefreshToken) },
      });
      assert.equal(session.status, 'REVOKED');
      assert.ok(session.revoked_at instanceof Date);
      await logout(rotatedRefreshToken).expect(204);
    });

    await t.test('device sessions cannot cross tenant boundaries', async () => {
      const rawToken = `${randomUUID()}${randomUUID()}`.replaceAll('-', '');
      await assert.rejects(
        db.device_sessions.create({
          data: {
            tenant_id: tenantA.id,
            user_id: userB.id,
            device_id: randomUUID(),
            refresh_token_hash: hashToken(rawToken),
            status: 'ACTIVE',
            expires_at: new Date(Date.now() + 60 * 60 * 1000),
          },
        }),
        (error) => error.code === 'P2003',
      );
    });
  } finally {
    await app?.close();
    await db?.$disconnect();
    await adminConnection.query('SET search_path TO public');
    await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminConnection.end();

    if (previousRefreshDays === undefined) {
      delete process.env.REFRESH_TOKEN_TTL_DAYS;
    } else {
      process.env.REFRESH_TOKEN_TTL_DAYS = previousRefreshDays;
    }
  }
});
