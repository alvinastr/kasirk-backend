// Run only against an isolated PostgreSQL database; the test owns one random schema.
require('reflect-metadata');

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { JwtService } = require('@nestjs/jwt');
const { Test } = require('@nestjs/testing');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const { Client } = require('pg');
const request = require('supertest');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/prisma/prisma.service');

process.env.JWT_SECRET ||= `receipt-settings-${randomUUID()}`;

const connectionString = process.env.RECEIPT_SETTINGS_TEST_DATABASE_URL;

test(
  'Outlet receipt settings API contract',
  { skip: !connectionString },
  async (t) => {
    const schema = `receipt_settings_${randomUUID().replaceAll('-', '')}`;
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
      await app.init();

      const http = request(app.getHttpServer());
      const jwt = testingModule.get(JwtService);
      const tenantA = await db.tenants.create({
        data: { name: 'Tenant A', address: 'Tenant Address' },
      });
      const tenantB = await db.tenants.create({
        data: { name: 'Tenant B' },
      });
      const outletA = await db.outlets.create({
        data: {
          tenant_id: tenantA.id,
          name: 'Outlet A',
          address: 'Outlet Address',
        },
      });
      const outletA2 = await db.outlets.create({
        data: { tenant_id: tenantA.id, name: 'Outlet A2' },
      });
      const outletB = await db.outlets.create({
        data: { tenant_id: tenantB.id, name: 'Outlet B' },
      });
      const inactiveOutlet = await db.outlets.create({
        data: {
          tenant_id: tenantA.id,
          name: 'Inactive Outlet',
          is_active: false,
        },
      });
      const createUser = (tenantId, role, email, assignedOutletId = null) =>
        db.users.create({
          data: {
            tenant_id: tenantId,
            outlet_id: assignedOutletId,
            name: role,
            email,
            password_hash: 'fixture',
            role,
          },
        });
      const [ownerA, adminA, cashierA, inactiveCashier, ownerB] =
        await Promise.all([
          createUser(tenantA.id, 'OWNER', 'owner-a@settings.test'),
          createUser(tenantA.id, 'ADMIN', 'admin-a@settings.test'),
          createUser(
            tenantA.id,
            'CASHIER',
            'cashier-a@settings.test',
            outletA.id,
          ),
          createUser(
            tenantA.id,
            'CASHIER',
            'inactive-cashier@settings.test',
            inactiveOutlet.id,
          ),
          createUser(tenantB.id, 'OWNER', 'owner-b@settings.test'),
        ]);
      const token = (user) =>
        jwt.sign({
          sub: user.id,
          tenant_id: user.tenant_id,
          outlet_id: user.outlet_id,
          role: user.role,
        });
      const tokens = {
        ownerA: token(ownerA),
        adminA: token(adminA),
        cashierA: token(cashierA),
        inactiveCashier: token(inactiveCashier),
        ownerB: token(ownerB),
      };
      const auth = (requestBuilder, accessToken) =>
        requestBuilder.set('Authorization', `Bearer ${accessToken}`);
      const settings = (overrides = {}) => ({
        header_store_name: 'Configured Store',
        header_outlet_name: 'Configured Outlet',
        header_address: 'Configured Address',
        header_phone: '08123456789',
        header_additional_text: 'Open daily',
        show_sku: false,
        show_modifiers: true,
        show_item_notes: false,
        show_cashier: true,
        show_customer: false,
        footer_thank_you_text: 'Thank you',
        footer_promo_text: 'Come again',
        ...overrides,
      });
      const without = (body, field) => {
        const copy = { ...body };
        delete copy[field];
        return copy;
      };

      await t.test(
        'synthesizes fallback without persisting a row',
        async () => {
          const response = await auth(
            http.get(`/outlets/${outletA.id}/receipt-settings`),
            tokens.cashierA,
          ).expect(200);

          assert.deepEqual(response.body, {
            tenant_id: tenantA.id,
            outlet_id: outletA.id,
            header_store_name: 'Tenant A',
            header_outlet_name: 'Outlet A',
            header_address: 'Outlet Address',
            header_phone: null,
            header_additional_text: null,
            show_sku: true,
            show_modifiers: true,
            show_item_notes: true,
            show_cashier: true,
            show_customer: true,
            footer_thank_you_text: 'Terima kasih',
            footer_promo_text: null,
            template_version: 1,
            created_at: null,
            updated_at: null,
          });
          assert.equal(await db.receipt_settings.count(), 0);
        },
      );

      await t.test(
        'OWNER creates and ADMIN fully replaces the same row',
        async () => {
          const created = await auth(
            http.put(`/outlets/${outletA.id}/receipt-settings`),
            tokens.ownerA,
          )
            .send(settings())
            .expect(200);
          assert.equal(created.body.tenant_id, tenantA.id);
          assert.equal(created.body.header_store_name, 'Configured Store');
          assert.equal(created.body.show_sku, false);
          assert.ok(created.body.created_at);

          const replacement = {
            header_store_name: '  Replacement Store  ',
            header_outlet_name: 'Replacement Outlet',
            header_address: null,
            header_phone: null,
            header_additional_text: null,
            show_sku: true,
            show_modifiers: false,
            show_item_notes: true,
            show_cashier: false,
            show_customer: true,
            footer_thank_you_text: 'Sampai jumpa',
            footer_promo_text: null,
          };
          const updated = await auth(
            http.put(`/outlets/${outletA.id}/receipt-settings`),
            tokens.adminA,
          )
            .send(replacement)
            .expect(200);
          assert.deepEqual(
            {
              header_store_name: updated.body.header_store_name,
              header_outlet_name: updated.body.header_outlet_name,
              header_address: updated.body.header_address,
              header_phone: updated.body.header_phone,
              header_additional_text: updated.body.header_additional_text,
              show_sku: updated.body.show_sku,
              show_modifiers: updated.body.show_modifiers,
              show_item_notes: updated.body.show_item_notes,
              show_cashier: updated.body.show_cashier,
              show_customer: updated.body.show_customer,
              footer_thank_you_text: updated.body.footer_thank_you_text,
              footer_promo_text: updated.body.footer_promo_text,
              template_version: updated.body.template_version,
            },
            {
              ...replacement,
              header_store_name: 'Replacement Store',
              template_version: 1,
            },
          );
          const persisted = await db.receipt_settings.findUniqueOrThrow({
            where: {
              tenant_id_outlet_id: {
                tenant_id: tenantA.id,
                outlet_id: outletA.id,
              },
            },
          });
          assert.deepEqual(
            {
              header_store_name: persisted.header_store_name,
              header_outlet_name: persisted.header_outlet_name,
              header_address: persisted.header_address,
              header_phone: persisted.header_phone,
              header_additional_text: persisted.header_additional_text,
              show_sku: persisted.show_sku,
              show_modifiers: persisted.show_modifiers,
              show_item_notes: persisted.show_item_notes,
              show_cashier: persisted.show_cashier,
              show_customer: persisted.show_customer,
              footer_thank_you_text: persisted.footer_thank_you_text,
              footer_promo_text: persisted.footer_promo_text,
              template_version: persisted.template_version,
            },
            {
              ...replacement,
              header_store_name: 'Replacement Store',
              template_version: 1,
            },
          );
          assert.equal(await db.receipt_settings.count(), 1);
        },
      );

      await t.test('GET returns stored settings', async () => {
        const response = await auth(
          http.get(`/outlets/${outletA.id}/receipt-settings`),
          tokens.ownerA,
        ).expect(200);
        assert.equal(response.body.header_store_name, 'Replacement Store');
        assert.equal(response.body.header_phone, null);
        assert.ok(response.body.created_at);
        assert.ok(response.body.updated_at);
      });

      await t.test(
        'CASHIER can read assigned outlet but cannot write',
        async () => {
          await auth(
            http.get(`/outlets/${outletA.id}/receipt-settings`),
            tokens.cashierA,
          ).expect(200);
          await auth(
            http.put(`/outlets/${outletA.id}/receipt-settings`),
            tokens.cashierA,
          )
            .send(settings())
            .expect(403);
          await auth(
            http.get(`/outlets/${outletA2.id}/receipt-settings`),
            tokens.cashierA,
          ).expect(403);
        },
      );

      await t.test(
        'tenant isolation and outlet ownership are enforced',
        async () => {
          await auth(
            http.get(`/outlets/${outletB.id}/receipt-settings`),
            tokens.ownerA,
          ).expect(404);
          await auth(
            http.put(`/outlets/${outletB.id}/receipt-settings`),
            tokens.ownerA,
          )
            .send(settings())
            .expect(404);
          await auth(
            http.get(`/outlets/${outletA.id}/receipt-settings`),
            tokens.ownerB,
          ).expect(404);
          await auth(
            http.get(`/outlets/${outletB.id}/receipt-settings`),
            tokens.cashierA,
          ).expect(403);
        },
      );

      await t.test(
        'inactive outlets are hidden from every readable role',
        async () => {
          for (const accessToken of [tokens.ownerA, tokens.adminA]) {
            await auth(
              http.get(`/outlets/${inactiveOutlet.id}/receipt-settings`),
              accessToken,
            ).expect(404);
            await auth(
              http.put(`/outlets/${inactiveOutlet.id}/receipt-settings`),
              accessToken,
            )
              .send(settings())
              .expect(404);
          }
          await auth(
            http.get(`/outlets/${inactiveOutlet.id}/receipt-settings`),
            tokens.inactiveCashier,
          ).expect(404);
        },
      );

      await t.test('validates route and body contract', async () => {
        await auth(
          http.get('/outlets/not-a-uuid/receipt-settings'),
          tokens.ownerA,
        ).expect(400);

        const invalidBodies = [
          without(settings(), 'header_phone'),
          settings({ header_store_name: '   ' }),
          settings({ footer_thank_you_text: '   ' }),
          settings({ header_phone: '   ' }),
          settings({ header_additional_text: 'x'.repeat(501) }),
          settings({ show_sku: 'true' }),
          { ...settings(), template_version: 1 },
          { ...settings(), tenant_id: tenantB.id },
          { ...settings(), unknown_field: true },
        ];
        for (const body of invalidBodies) {
          await auth(
            http.put(`/outlets/${outletA2.id}/receipt-settings`),
            tokens.ownerA,
          )
            .send(body)
            .expect(400);
        }
        assert.equal(
          await db.receipt_settings.count({
            where: { tenant_id: tenantA.id, outlet_id: outletA2.id },
          }),
          0,
        );
      });

      await t.test('database rejects an invalid template version', async () => {
        await assert.rejects(
          adminConnection.query(
            'UPDATE "receipt_settings" SET "template_version" = $1 WHERE "tenant_id" = $2 AND "outlet_id" = $3',
            [0, tenantA.id, outletA.id],
          ),
          (error) => {
            assert.equal(error.code, '23514');
            assert.equal(
              error.constraint,
              'chk_receipt_settings_template_version',
            );
            return true;
          },
        );
        const persisted = await db.receipt_settings.findUniqueOrThrow({
          where: {
            tenant_id_outlet_id: {
              tenant_id: tenantA.id,
              outlet_id: outletA.id,
            },
          },
          select: { template_version: true },
        });
        assert.equal(persisted.template_version, 1);
      });
    } finally {
      if (app) await app.close();
      if (db) await db.$disconnect();
      await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminConnection.end();
    }
  },
);
