// Run with:
// TS_NODE_PROJECT=test/tsconfig.hardening.json node --require ts-node/register/transpile-only --test test/rbac.integration.cjs
require('reflect-metadata');

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { Test } = require('@nestjs/testing');
const request = require('supertest');
const { AuthModule } = require('../src/auth/auth.module');
const { CategoriesController } = require('../src/categories/categories.controller');
const { CategoriesService } = require('../src/categories/categories.service');
const { OutletsController } = require('../src/outlets/outlets.controller');
const { OutletsService } = require('../src/outlets/outlets.service');
const { PrismaService } = require('../src/prisma/prisma.service');
const { ProductsController } = require('../src/products/products.controller');
const { ProductsService } = require('../src/products/products.service');
const { StockController } = require('../src/stock/stock.controller');
const { StockService } = require('../src/stock/stock.service');
const { TransactionsController } = require('../src/transactions/transactions.controller');
const { TransactionsService } = require('../src/transactions/transactions.service');
const { UsersController } = require('../src/users/users.controller');
const { UsersService } = require('../src/users/users.service');

test('RBAC protects existing endpoints', async (t) => {
    const createResponse = (resource) => ({
        create: (user) => ({ resource, role: user.role }),
        findAll: (user) => ({ resource, role: user.role }),
        findByOutlet: (user) => ({ resource, role: user.role }),
        createAdjustment: (user) => ({ resource, role: user.role }),
        findOne: (user) => ({ resource, role: user.role }),
    });
    const testingModule = await Test.createTestingModule({
        imports: [AuthModule],
        controllers: [
            UsersController,
            OutletsController,
            ProductsController,
            CategoriesController,
            StockController,
            TransactionsController,
        ],
        providers: [
            { provide: UsersService, useValue: createResponse('users') },
            { provide: OutletsService, useValue: createResponse('outlets') },
            { provide: ProductsService, useValue: createResponse('products') },
            { provide: CategoriesService, useValue: createResponse('categories') },
            { provide: StockService, useValue: createResponse('stock') },
            { provide: TransactionsService, useValue: createResponse('transactions') },
        ],
    })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile();

    const app = testingModule.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    try {
        const http = request(app.getHttpServer());
        const jwt = testingModule.get(JwtService);
        const tenantId = randomUUID();
        const outletId = randomUUID();
        const productId = randomUUID();
        const token = (role) => jwt.sign({ sub: randomUUID(), tenant_id: tenantId, role });
        const owner = token('OWNER');
        const admin = token('ADMIN');
        const cashier = token('CASHIER');
        const manager = token('MANAGER');
        const post = (path, authorization, body) => http
            .post(path)
            .set('Authorization', `Bearer ${authorization}`)
            .send(body);

        const protectedPosts = [
            ['/users', { name: 'User', email: 'user@example.test', password: 'secret', role: 'CASHIER' }],
            ['/outlets', { name: 'Outlet' }],
            ['/products', { name: 'Product', sku: 'SKU-1', price: 100, cost: 50, minimum_stock: 0 }],
            ['/categories', { name: 'Category' }],
            ['/stock/adjustment', { outlet_id: outletId, product_id: productId, adjustment_type: 'ADD', quantity: 1, reason: 'Restock' }],
            ['/transactions', {
                client_transaction_id: randomUUID(),
                outlet_id: outletId,
                items: [{ product_id: productId, quantity: 1 }],
                payment: { method: 'CASH', amount: 100 },
            }],
        ];

        await t.test('OWNER can access every protected POST endpoint', async () => {
            for (const [path, body] of protectedPosts) {
                const response = await post(path, owner, body).expect(201);
                assert.equal(response.body.role, 'OWNER');
            }
        });

        await t.test('ADMIN cannot create users or outlets', async () => {
            await post('/users', admin, protectedPosts[0][1]).expect(403);
            await post('/outlets', admin, protectedPosts[1][1]).expect(403);
        });

        await t.test('ADMIN can manage products, categories and stock', async () => {
            for (const [path, body] of protectedPosts.slice(2, 5)) {
                const response = await post(path, admin, body).expect(201);
                assert.equal(response.body.role, 'ADMIN');
            }
        });

        await t.test('CASHIER cannot adjust stock', async () => {
            await post('/stock/adjustment', cashier, protectedPosts[4][1]).expect(403);
        });

        await t.test('CASHIER can create transactions', async () => {
            const response = await post('/transactions', cashier, protectedPosts[5][1]).expect(201);
            assert.equal(response.body.role, 'CASHIER');
        });

        await t.test('unlisted roles cannot create transactions', async () => {
            await post('/transactions', manager, protectedPosts[5][1]).expect(403);
        });

        await t.test('authentication runs before role authorization', async () => {
            await http.post('/users').send(protectedPosts[0][1]).expect(401);
        });

        await t.test('GET endpoints remain available to authenticated roles', async () => {
            const response = await http.get('/products')
                .set('Authorization', `Bearer ${cashier}`)
                .expect(200);
            assert.equal(response.body.role, 'CASHIER');
        });
    } finally {
        await app.close();
    }
});
