// Run with: npm run test:product-category
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
const { Client } = require('pg');
const request = require('supertest');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/prisma/prisma.service');

const connectionString =
  process.env.PRODUCT_CATEGORY_TEST_DATABASE_URL || process.env.DATABASE_URL;

test(
  'Product and category API contract',
  { skip: !connectionString },
  async (t) => {
    const schema = `product_category_${randomUUID().replaceAll('-', '')}`;
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
      const tenantA = await db.tenants.create({ data: { name: 'Tenant A' } });
      const tenantB = await db.tenants.create({ data: { name: 'Tenant B' } });
      const createUser = (tenantId, role, email) =>
        db.users.create({
          data: {
            tenant_id: tenantId,
            name: role,
            email,
            password_hash: 'fixture',
            role,
          },
        });
      const [ownerA, adminA, cashierA, ownerB] = await Promise.all([
        createUser(tenantA.id, 'OWNER', 'owner-a@product.test'),
        createUser(tenantA.id, 'ADMIN', 'admin-a@product.test'),
        createUser(tenantA.id, 'CASHIER', 'cashier-a@product.test'),
        createUser(tenantB.id, 'OWNER', 'owner-b@product.test'),
      ]);
      const token = (user) =>
        jwt.sign({
          sub: user.id,
          tenant_id: user.tenant_id,
          role: user.role,
        });
      const tokens = {
        ownerA: token(ownerA),
        adminA: token(adminA),
        cashierA: token(cashierA),
        ownerB: token(ownerB),
      };
      const auth = (requestBuilder, authToken) =>
        requestBuilder.set('Authorization', `Bearer ${authToken}`);
      const productPayload = (sku, overrides = {}) => ({
        name: `Product ${sku}`,
        sku,
        price: 10_000,
        cost: 5_000,
        minimum_stock: 0,
        ...overrides,
      });

      let ownedCategory;
      let foreignCategory;
      let ownerProduct;
      let adminProduct;

      await t.test(
        'OWNER and ADMIN create categories and products',
        async () => {
          ownedCategory = (
            await auth(http.post('/categories'), tokens.ownerA)
              .send({ name: 'Beverages' })
              .expect(201)
          ).body;
          const adminCategory = (
            await auth(http.post('/categories'), tokens.adminA)
              .send({ name: 'Food' })
              .expect(201)
          ).body;
          foreignCategory = (
            await auth(http.post('/categories'), tokens.ownerB)
              .send({ name: 'Beverages' })
              .expect(201)
          ).body;

          ownerProduct = (
            await auth(http.post('/products'), tokens.ownerA)
              .send(
                productPayload('SKU-SHARED', {
                  category_id: ownedCategory.id,
                }),
              )
              .expect(201)
          ).body;
          adminProduct = (
            await auth(http.post('/products'), tokens.adminA)
              .send(
                productPayload('SKU-ADMIN', {
                  category_id: adminCategory.id,
                }),
              )
              .expect(201)
          ).body;

          assert.equal(ownerProduct.tenant_id, tenantA.id);
          assert.equal(adminProduct.tenant_id, tenantA.id);
          assert.equal(ownerProduct.track_stock, true);
        },
      );

      await t.test(
        'duplicate SKU is mapped only within the same tenant',
        async () => {
          const duplicate = await auth(http.post('/products'), tokens.adminA)
            .send(productPayload('SKU-SHARED'))
            .expect(409);
          assert.deepEqual(
            {
              error_code: duplicate.body.error_code,
              message: duplicate.body.message,
            },
            {
              error_code: 'SKU_ALREADY_EXISTS',
              message: 'Product SKU already exists',
            },
          );

          const otherTenant = await auth(http.post('/products'), tokens.ownerB)
            .send(productPayload('SKU-SHARED'))
            .expect(201);
          assert.equal(otherTenant.body.tenant_id, tenantB.id);

          const duplicateUpdate = await auth(
            http.patch(`/products/${adminProduct.id}`),
            tokens.ownerA,
          )
            .send({ sku: 'SKU-SHARED' })
            .expect(409);
          assert.equal(duplicateUpdate.body.error_code, 'SKU_ALREADY_EXISTS');
        },
      );

      await t.test('product DTO rejects invalid database values', async () => {
        const invalidBodies = [
          productPayload('BAD-UUID', { category_id: 'not-a-uuid' }),
          productPayload('BAD-PRICE', { price: -1 }),
          productPayload('DECIMAL-PRICE', { price: 1.5 }),
          productPayload('STRING-PRICE', { price: '100' }),
          productPayload('BAD-COST', { cost: -1 }),
          productPayload('BAD-MIN', { minimum_stock: -1 }),
          productPayload('BAD-TRACK', { track_stock: 'false' }),
          productPayload('BAD-NAME', { name: '   ' }),
        ];
        for (const body of invalidBodies) {
          await auth(http.post('/products'), tokens.ownerA)
            .send(body)
            .expect(400);
        }
      });

      await t.test(
        'missing and foreign categories return stable 404',
        async () => {
          for (const categoryId of [randomUUID(), foreignCategory.id]) {
            const createResponse = await auth(
              http.post('/products'),
              tokens.ownerA,
            )
              .send(productPayload(randomUUID(), { category_id: categoryId }))
              .expect(404);
            assert.equal(createResponse.body.error_code, 'CATEGORY_NOT_FOUND');
            assert.equal(createResponse.body.message, 'Category not found');

            const updateResponse = await auth(
              http.patch(`/products/${ownerProduct.id}`),
              tokens.ownerA,
            )
              .send({ category_id: categoryId })
              .expect(404);
            assert.equal(updateResponse.body.error_code, 'CATEGORY_NOT_FOUND');
            assert.equal(updateResponse.body.message, 'Category not found');
          }

          await auth(http.patch(`/products/${ownerProduct.id}`), tokens.ownerA)
            .send({ category_id: 'not-a-uuid' })
            .expect(400);
        },
      );

      await t.test(
        'same-tenant PATCH updates supported optional fields',
        async () => {
          const response = await auth(
            http.patch(`/products/${ownerProduct.id}`),
            tokens.adminA,
          )
            .send({
              name: 'Updated Product',
              price: 12_000,
              cost: 6_000,
              minimum_stock: 3,
              category_id: null,
              track_stock: false,
            })
            .expect(200);
          assert.equal(response.body.name, 'Updated Product');
          assert.equal(response.body.category_id, null);
          assert.equal(response.body.track_stock, false);
        },
      );

      await t.test(
        'missing and cross-tenant PATCH return the same 404',
        async () => {
          const foreignProduct = await db.products.findFirstOrThrow({
            where: { tenant_id: tenantB.id, sku: 'SKU-SHARED' },
          });
          for (const productId of [randomUUID(), foreignProduct.id]) {
            const response = await auth(
              http.patch(`/products/${productId}`),
              tokens.ownerA,
            )
              .send({ name: 'Forbidden mutation' })
              .expect(404);
            assert.equal(response.body.error_code, 'PRODUCT_NOT_FOUND');
            assert.equal(response.body.message, 'Product not found');
          }
          assert.equal(
            (
              await db.products.findUniqueOrThrow({
                where: { id: foreignProduct.id },
              })
            ).name,
            foreignProduct.name,
          );
        },
      );

      await t.test(
        'track_stock=false remains writable on create and update',
        async () => {
          const created = await auth(http.post('/products'), tokens.ownerA)
            .send(productPayload('UNTRACKED', { track_stock: false }))
            .expect(201);
          assert.equal(created.body.track_stock, false);

          const enabled = await auth(
            http.patch(`/products/${created.body.id}`),
            tokens.ownerA,
          )
            .send({ track_stock: true })
            .expect(200);
          assert.equal(enabled.body.track_stock, true);
        },
      );

      await t.test(
        'CASHIER reads but cannot mutate products or categories',
        async () => {
          const products = await auth(
            http.get('/products'),
            tokens.cashierA,
          ).expect(200);
          const categories = await auth(
            http.get('/categories'),
            tokens.cashierA,
          ).expect(200);
          assert.ok(
            products.body.every((product) => product.tenant_id === tenantA.id),
          );
          assert.ok(
            categories.body.every(
              (category) => category.tenant_id === tenantA.id,
            ),
          );
          await auth(http.post('/products'), tokens.cashierA)
            .send(productPayload('CASHIER-CREATE'))
            .expect(403);
          await auth(
            http.patch(`/products/${ownerProduct.id}`),
            tokens.cashierA,
          )
            .send({ name: 'Cashier update' })
            .expect(403);
          await auth(http.post('/categories'), tokens.cashierA)
            .send({ name: 'Cashier category' })
            .expect(403);
        },
      );

      await t.test(
        'category duplicate names use tenant-scoped 409 mapping',
        async () => {
          const duplicate = await auth(http.post('/categories'), tokens.adminA)
            .send({ name: 'Beverages' })
            .expect(409);
          assert.equal(
            duplicate.body.error_code,
            'CATEGORY_NAME_ALREADY_EXISTS',
          );
          assert.equal(duplicate.body.message, 'Category name already exists');

          await auth(http.post('/categories'), tokens.ownerB)
            .send({ name: 'Food' })
            .expect(201);
          await auth(http.post('/categories'), tokens.ownerA)
            .send({ name: '   ' })
            .expect(400);
        },
      );
    } finally {
      await app?.close();
      await db?.$disconnect();
      await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminConnection.end();
    }
  },
);
