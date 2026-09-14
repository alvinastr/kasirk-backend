import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { validate } from 'class-validator';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { StockService } from '../src/stock/stock.service';
import { UsersService } from '../src/users/users.service';
import { ProductsService } from '../src/products/products.service';
import { CategoriesService } from '../src/categories/categories.service';
import { CreateStockAdjustmentDto } from '../src/stock/dto/create-stock-adjustment.dto';
import type { PrismaService } from '../src/prisma/prisma.service';

// Requires an explicitly supplied disposable database; never reads DATABASE_URL.
// Each run creates and drops only its own randomly named schema.
test('Phase 1 hardening against PostgreSQL', { skip: !process.env.HARDENING_DATABASE_URL }, async (t) => {
    const connectionString = process.env.HARDENING_DATABASE_URL!;
    const schema = `hardening_${randomUUID().replaceAll('-', '')}`;
    const admin = new Client({ connectionString });
    await admin.connect();
    let db: PrismaClient | undefined;
    try {
        const ddl = execFileSync(process.execPath, [
            'node_modules/prisma/build/index.js', 'migrate', 'diff',
            '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script',
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        await admin.query(`CREATE SCHEMA "${schema}"`);
        await admin.query(`SET search_path TO "${schema}"`);
        await admin.query(ddl.replaceAll('"public"', `"${schema}"`));
        db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
        const prisma = db as PrismaService;
        const stock = new StockService(prisma);
        const users = new UsersService(prisma);
        const products = new ProductsService(prisma);
        const categories = new CategoriesService(prisma);
        const tenant = await db.tenants.create({ data: { name: 'Tenant A' } });
        const other = await db.tenants.create({ data: { name: 'Tenant B' } });
        const actor = await db.users.create({ data: {
            tenant_id: tenant.id, name: 'Owner', email: 'owner@example.test',
            password_hash: 'test-fixture', role: 'OWNER',
        } });
        const user = new JwtStrategy().validate({ sub: actor.id, tenant_id: tenant.id, role: 'OWNER' });
        const outlet = await db.outlets.create({ data: { tenant_id: tenant.id, name: 'A' } });
        const foreignOutlet = await db.outlets.create({ data: { tenant_id: other.id, name: 'B' } });
        const foreignCategory = await db.categories.create({ data: { tenant_id: other.id, name: 'B' } });
        const foreignProduct = await db.products.create({ data: { tenant_id: other.id, name: 'B', sku: 'B' } });
        const makeProduct = () => db!.products.create({ data: { tenant_id: tenant.id, name: 'Product', sku: randomUUID() } });
        const adjustment = (product_id: string, adjustment_type: 'ADD' | 'DEDUCT', quantity: number) => ({
            outlet_id: outlet.id, product_id, adjustment_type, quantity, reason: 'Test adjustment',
        });

        await t.test('JWT preserves sub and rejects incomplete tenant context', () => {
            assert.equal(user.sub, actor.id);
            assert.equal(user.tenant_id, tenant.id);
            assert.equal('user_id' in user, false);
            assert.throws(() => new JwtStrategy().validate({ ...user, tenant_id: '' }));
            assert.throws(() => new JwtStrategy().validate({ ...user, sub: '' }));
        });

        await t.test('DTO rejects invalid types, quantities and blank reasons', async () => {
            for (const patch of [{ quantity: 0 }, { quantity: -1 }, { quantity: 1.5 },
                { adjustment_type: 'INVALID' }, { reason: '   ' }, { outlet_id: 'bad-id' }]) {
                const dto = Object.assign(new CreateStockAdjustmentDto(), adjustment(foreignProduct.id, 'ADD', 1), patch);
                assert.ok((await validate(dto)).length > 0);
            }
            assert.equal((await validate(Object.assign(new CreateStockAdjustmentDto(), adjustment(foreignProduct.id, 'ADD', 1)))).length, 0);
        });

        await t.test('foreign outlet, product and actor cannot adjust stock', async () => {
            const product = await makeProduct();
            await assert.rejects(stock.findByOutlet(user, foreignOutlet.id), { status: 404 });
            await assert.rejects(stock.createAdjustment(user, { ...adjustment(product.id, 'ADD', 2), outlet_id: foreignOutlet.id }), { status: 404 });
            await assert.rejects(stock.createAdjustment(user, adjustment(foreignProduct.id, 'ADD', 2)), { status: 404 });
            await assert.rejects(stock.createAdjustment({ ...user, sub: randomUUID() }, adjustment(product.id, 'ADD', 2)), { status: 404 });
            assert.equal(await db!.product_stocks.count({ where: { product_id: product.id } }), 0);
        });

        await t.test('legacy cross-tenant product link is excluded from stock reads', async () => {
            await db!.product_stocks.create({ data: { outlet_id: outlet.id, product_id: foreignProduct.id, stock: 1 } });
            const rows = await stock.findByOutlet(user, outlet.id);
            assert.ok(rows.every((row) => row.products.tenant_id === tenant.id));
        });

        await t.test('ADD and DEDUCT persist signed movements linked to actor and adjustment', async () => {
            const product = await makeProduct();
            assert.equal((await stock.createAdjustment(user, adjustment(product.id, 'ADD', 10))).stock, 10);
            assert.equal((await stock.createAdjustment(user, adjustment(product.id, 'DEDUCT', 3))).stock, 7);
            const movements = await db!.stock_movements.findMany({ where: { product_id: product.id }, orderBy: { created_at: 'asc' } });
            assert.deepEqual(movements.map((m) => m.quantity), [10, -3]);
            for (const movement of movements) {
                assert.equal(movement.type, 'ADJUSTMENT');
                assert.equal(movement.user_id, actor.id);
                assert.equal(movement.reference_type, 'STOCK_ADJUSTMENT');
                assert.ok(await db!.stock_adjustments.findUnique({ where: { id: movement.reference_id! } }));
            }
        });

        await t.test('DEDUCT on missing stock does not create stock or audit', async () => {
            const product = await makeProduct();
            await assert.rejects(stock.createAdjustment(user, adjustment(product.id, 'DEDUCT', 1)), { status: 409 });
            assert.equal(await db!.product_stocks.count({ where: { product_id: product.id } }), 0);
            assert.equal(await db!.stock_adjustments.count({ where: { product_id: product.id } }), 0);
        });

        await t.test('concurrent deductions cannot oversell', async () => {
            const product = await makeProduct();
            await stock.createAdjustment(user, adjustment(product.id, 'ADD', 10));
            const results = await Promise.allSettled([
                stock.createAdjustment(user, adjustment(product.id, 'DEDUCT', 7)),
                stock.createAdjustment(user, adjustment(product.id, 'DEDUCT', 7)),
            ]);
            assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
            const failure = results.find((r) => r.status === 'rejected');
            assert.equal(failure?.status === 'rejected' && failure.reason.status, 409);
            assert.equal((await db!.product_stocks.findFirstOrThrow({ where: { product_id: product.id } })).stock, 3);
            assert.equal(await db!.stock_movements.count({ where: { product_id: product.id } }), 2);
        });

        await t.test('concurrent first ADD requests both contribute to stock', async () => {
            const product = await makeProduct();
            await Promise.all([
                stock.createAdjustment(user, adjustment(product.id, 'ADD', 3)),
                stock.createAdjustment(user, adjustment(product.id, 'ADD', 4)),
            ]);
            assert.equal((await db!.product_stocks.findFirstOrThrow({ where: { product_id: product.id } })).stock, 7);
            assert.equal(await db!.stock_movements.count({ where: { product_id: product.id } }), 2);
        });

        await t.test('database audit failure rolls back balance and adjustment', async () => {
            const product = await makeProduct();
            await stock.createAdjustment(user, adjustment(product.id, 'ADD', 5));
            await admin.query(`ALTER TABLE "${schema}".stock_movements ADD CONSTRAINT test_failure CHECK (reason <> 'force failure')`);
            try {
                await assert.rejects(stock.createAdjustment(user, { ...adjustment(product.id, 'DEDUCT', 2), reason: 'force failure' }));
                assert.equal((await db!.product_stocks.findFirstOrThrow({ where: { product_id: product.id } })).stock, 5);
                assert.equal(await db!.stock_adjustments.count({ where: { product_id: product.id } }), 1);
                assert.equal(await db!.stock_movements.count({ where: { product_id: product.id } }), 1);
            } finally {
                await admin.query(`ALTER TABLE "${schema}".stock_movements DROP CONSTRAINT test_failure`);
            }
        });

        await t.test('products reject foreign category and accept owned category', async () => {
            const dto = { name: 'Product', sku: randomUUID(), price: 100, cost: 50, minimum_stock: 0 };
            await assert.rejects(products.create(user, { ...dto, category_id: foreignCategory.id }), { status: 404 });
            assert.equal(await db!.products.count({ where: { sku: dto.sku } }), 0);
            const category = await categories.create(user, { name: 'Owned' });
            assert.equal((await products.create(user, { ...dto, category_id: category.id })).category_id, category.id);
            assert.equal((await products.create(user, { ...dto, sku: randomUUID() })).category_id, null);
        });

        await t.test('users reject foreign outlet and never return password hash', async () => {
            const dto = { name: 'Cashier', email: 'cashier@example.test', password: 'secret-password', role: 'CASHIER' };
            await assert.rejects(users.create(user, { ...dto, outlet_id: foreignOutlet.id }), { status: 404 });
            assert.equal(await db!.users.count({ where: { email: dto.email } }), 0);
            const result = await users.create(user, { ...dto, outlet_id: outlet.id });
            assert.equal('password_hash' in result, false);
            assert.equal('password' in result, false);
            const stored = await db!.users.findUniqueOrThrow({ where: { id: result.id } });
            assert.notEqual(stored.password_hash, dto.password);
            assert.ok(stored.password_hash.startsWith('$2'));
            assert.equal((await users.create(user, { ...dto, email: 'unassigned@example.test' })).outlet_id, null);
        });

        await t.test('categories list works against schema and remains tenant scoped', async () => {
            const rows = await categories.findAll(user);
            assert.ok(rows.length > 0);
            assert.ok(rows.every((row) => row.tenant_id === tenant.id));
            assert.ok(!rows.some((row) => row.id === foreignCategory.id));
        });
    } finally {
        await db?.$disconnect();
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
    }
});
