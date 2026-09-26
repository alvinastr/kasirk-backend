// Run with: npm run test:auth
require('reflect-metadata');

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { ConfigModule, ConfigService } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { Test } = require('@nestjs/testing');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { AuthModule } = require('../src/auth/auth.module');
const { AuthService } = require('../src/auth/auth.service');
const { getJwtSecret } = require('../src/auth/jwt.config');
const { JwtStrategy } = require('../src/auth/jwt.strategy');
const { PrismaService } = require('../src/prisma/prisma.service');

test('Auth hardening', async (t) => {
  const originalSecret = process.env.JWT_SECRET;
  const configuredSecret = `auth-test-${randomUUID()}-${randomUUID()}`;
  process.env.JWT_SECRET = configuredSecret;

  const tenantId = randomUUID();
  const inactiveTenantId = randomUUID();
  const outletId = randomUUID();
  const password = 'correct-password';
  const passwordHash = await bcrypt.hash(password, 4);
  const users = [
    {
      id: randomUUID(),
      tenant_id: tenantId,
      outlet_id: outletId,
      name: 'Active Cashier',
      email: 'active@auth.test',
      password_hash: passwordHash,
      role: 'CASHIER',
      is_active: true,
    },
    {
      id: randomUUID(),
      tenant_id: tenantId,
      outlet_id: null,
      name: 'Inactive Owner',
      email: 'inactive@auth.test',
      password_hash: passwordHash,
      role: 'OWNER',
      is_active: false,
    },
  ];
  const tenants = [
    {
      id: tenantId,
      store_code: 'KASIRKITA',
      name: 'KasirKita Demo',
      is_active: true,
    },
    {
      id: inactiveTenantId,
      store_code: 'INACTIVE-STORE',
      name: 'Inactive Store',
      is_active: false,
    },
  ];
  let lastResolveStoreQuery;
  const prisma = {
    tenants: {
      findFirst: async (query) => {
        lastResolveStoreQuery = query;
        const tenant = tenants.find(
          (candidate) =>
            candidate.store_code === query.where.store_code &&
            candidate.is_active === query.where.is_active,
        );
        if (!tenant) return null;
        return {
          id: tenant.id,
          name: tenant.name,
          users: users
            .filter(
              (user) => user.tenant_id === tenant.id && user.is_active === true,
            )
            .map((user) => ({
              id: user.id,
              name: user.name,
              role: user.role,
              outlet_id: user.outlet_id,
            })),
        };
      },
    },
    users: {
      findUnique: async ({ where }) => {
        const identity = where.tenant_id_email;
        return (
          users.find(
            (user) =>
              user.tenant_id === identity.tenant_id &&
              user.email === identity.email,
          ) ?? null
        );
      },
      findFirst: async ({ where }) => {
        const tenant = tenants.find(
          (candidate) =>
            candidate.id === where.tenant_id &&
            candidate.is_active === where.tenants?.is_active,
        );
        const user = users.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.tenant_id === where.tenant_id &&
            candidate.is_active === where.is_active,
        );
        if (!tenant || !user) return null;
        return {
          id: user.id,
          name: user.name,
          role: user.role,
          tenant_id: user.tenant_id,
          outlet_id: user.outlet_id,
        };
      },
    },
  };

  let testingModule;
  let app;
  try {
    testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = testingModule.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    const auth = testingModule.get(AuthService);
    const jwt = testingModule.get(JwtService);
    const strategy = testingModule.get(JwtStrategy);

    await t.test('correct tenant, email and password issue a JWT', async () => {
      const result = await auth.login({
        tenant_id: tenantId,
        email: 'active@auth.test',
        password,
      });
      assert.equal(typeof result.access_token, 'string');

      const payload = jwt.verify(result.access_token);
      assert.equal(payload.sub, users[0].id);
      assert.equal(payload.tenant_id, tenantId);
      assert.equal(payload.role, 'CASHIER');
      assert.equal(payload.outlet_id, outletId);
      assert.deepEqual(strategy.validate(payload), {
        sub: users[0].id,
        tenant_id: tenantId,
        role: 'CASHIER',
        outlet_id: outletId,
      });
    });

    await t.test('wrong password is unauthorized', async () => {
      await assert.rejects(
        auth.login({
          tenant_id: tenantId,
          email: 'active@auth.test',
          password: 'wrong-password',
        }),
        (error) => error.status === 401,
      );
    });

    await t.test('wrong tenant is unauthorized', async () => {
      await assert.rejects(
        auth.login({
          tenant_id: randomUUID(),
          email: 'active@auth.test',
          password,
        }),
        (error) => error.status === 401,
      );
    });

    await t.test('inactive user is unauthorized', async () => {
      await assert.rejects(
        auth.login({
          tenant_id: tenantId,
          email: 'inactive@auth.test',
          password,
        }),
        (error) => error.status === 401,
      );
    });

    await t.test(
      'JWT module and strategy use the configured secret',
      async () => {
        assert.equal(
          getJwtSecret(new ConfigService({ JWT_SECRET: configuredSecret })),
          configuredSecret,
        );
        assert.throws(
          () => getJwtSecret(new ConfigService({ JWT_SECRET: '' })),
          /JWT_SECRET is required/,
        );

        const result = await auth.login({
          tenant_id: tenantId,
          email: 'active@auth.test',
          password,
        });
        assert.doesNotThrow(() => jwt.verify(result.access_token));
        assert.throws(() =>
          new JwtService({ secret: 'different-test-secret' }).verify(
            result.access_token,
          ),
        );
      },
    );

    await t.test('strategy rejects malformed identity fields', () => {
      const validPayload = {
        sub: users[0].id,
        tenant_id: tenantId,
        role: 'CASHIER',
        outlet_id: outletId,
      };
      assert.throws(() => strategy.validate({ ...validPayload, sub: 'bad' }));
      assert.throws(() =>
        strategy.validate({ ...validPayload, tenant_id: 'bad' }),
      );
      assert.throws(() =>
        strategy.validate({ ...validPayload, outlet_id: 'bad' }),
      );
      assert.deepEqual(
        strategy.validate({ ...validPayload, outlet_id: null }),
        {
          ...validPayload,
          outlet_id: null,
        },
      );
    });

    await t.test(
      'authenticated user can get a safe current profile',
      async () => {
        const accessToken = jwt.sign({
          sub: users[0].id,
          tenant_id: tenantId,
          role: users[0].role,
          outlet_id: users[0].outlet_id,
        });

        const response = await request(app.getHttpServer())
          .get('/auth/v2/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        assert.deepEqual(response.body, {
          id: users[0].id,
          name: users[0].name,
          role: users[0].role,
          tenant_id: tenantId,
          outlet_id: outletId,
        });
        for (const field of [
          'email',
          'password_hash',
          'pin_hash',
          'refresh_token',
          'refresh_token_hash',
        ]) {
          assert.equal(Object.hasOwn(response.body, field), false);
        }
      },
    );

    await t.test('inactive current user is unauthorized', async () => {
      const accessToken = jwt.sign({
        sub: users[1].id,
        tenant_id: tenantId,
        role: users[1].role,
        outlet_id: users[1].outlet_id,
      });

      const response = await request(app.getHttpServer())
        .get('/auth/v2/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      assert.equal(response.body.error_code, 'CURRENT_USER_UNAVAILABLE');
    });

    await t.test('tenant mismatch is unauthorized', async () => {
      const accessToken = jwt.sign({
        sub: users[0].id,
        tenant_id: inactiveTenantId,
        role: users[0].role,
        outlet_id: users[0].outlet_id,
      });

      const response = await request(app.getHttpServer())
        .get('/auth/v2/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      assert.equal(response.body.error_code, 'CURRENT_USER_UNAVAILABLE');
    });

    await t.test('inactive tenant is unauthorized', async () => {
      const inactiveTenantUser = {
        ...users[0],
        id: randomUUID(),
        tenant_id: inactiveTenantId,
      };
      users.push(inactiveTenantUser);
      const accessToken = jwt.sign({
        sub: inactiveTenantUser.id,
        tenant_id: inactiveTenantId,
        role: inactiveTenantUser.role,
        outlet_id: inactiveTenantUser.outlet_id,
      });

      const response = await request(app.getHttpServer())
        .get('/auth/v2/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      assert.equal(response.body.error_code, 'CURRENT_USER_UNAVAILABLE');
    });

    await t.test(
      'store discovery returns only active users and safe fields',
      async () => {
        const response = await request(app.getHttpServer())
          .post('/auth/v2/store/resolve')
          .send({ store_code: 'KASIRKITA' })
          .expect(200);

        assert.deepEqual(response.body, {
          tenant: {
            id: tenantId,
            name: 'KasirKita Demo',
          },
          users: [
            {
              id: users[0].id,
              name: 'Active Cashier',
              role: 'CASHIER',
              outlet_id: outletId,
            },
          ],
        });
        assert.deepEqual(lastResolveStoreQuery, {
          where: {
            store_code: 'KASIRKITA',
            is_active: true,
          },
          select: {
            id: true,
            name: true,
            users: {
              where: {
                is_active: true,
              },
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                name: true,
                role: true,
                outlet_id: true,
              },
            },
          },
        });
        for (const user of response.body.users) {
          assert.equal(Object.hasOwn(user, 'email'), false);
          assert.equal(Object.hasOwn(user, 'password_hash'), false);
          assert.equal(Object.hasOwn(user, 'pin_hash'), false);
        }
      },
    );

    await t.test(
      'inactive and unknown stores return the same stable 404',
      async () => {
        for (const storeCode of ['INACTIVE-STORE', 'UNKNOWN-STORE']) {
          const response = await request(app.getHttpServer())
            .post('/auth/v2/store/resolve')
            .send({ store_code: storeCode })
            .expect(404);
          assert.equal(response.body.error_code, 'STORE_NOT_FOUND');
          assert.equal(response.body.message, 'Store not found');
        }
      },
    );

    await t.test('store discovery validates store_code', async () => {
      for (const body of [
        {},
        { store_code: '' },
        { store_code: 'ab' },
        { store_code: 'lowercase' },
        { store_code: 'INVALID CODE' },
        { store_code: 123456 },
      ]) {
        await request(app.getHttpServer())
          .post('/auth/v2/store/resolve')
          .send(body)
          .expect(400);
      }
    });
  } finally {
    await app?.close();
    if (!app) {
      await testingModule?.close();
    }
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});
