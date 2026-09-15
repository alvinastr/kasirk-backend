// Run with: npm run test:reports
require('reflect-metadata');

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { ForbiddenException, NotFoundException } = require('@nestjs/common');
const { Reflector } = require('@nestjs/core');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { ReportsController } = require('../src/reports/reports.controller');
const {
  DailySalesQueryDto,
} = require('../src/reports/dto/daily-sales-query.dto');
const {
  SalesSummaryQueryDto,
} = require('../src/reports/dto/sales-summary-query.dto');
const {
  TopProductsQueryDto,
} = require('../src/reports/dto/top-products-query.dto');
const { ReportsService } = require('../src/reports/reports.service');
const { RolesGuard } = require('../src/common/guards/roles.guard');

function subject(role = 'OWNER') {
  const calls = { actor: [], outlet: [], query: [], transaction: [] };
  const rows = [];
  let outlet = { id: null };
  const tx = {
    users: {
      findFirst: async (args) => {
        calls.actor.push(args);
        return { role };
      },
    },
    outlets: {
      findFirst: async (args) => {
        calls.outlet.push(args);
        return outlet;
      },
    },
    $queryRaw: async (query) => {
      calls.query.push(query);
      return rows.shift() ?? [];
    },
  };
  const prisma = {
    $transaction: async (callback, options) => {
      calls.transaction.push(options);
      return callback(tx);
    },
  };

  return {
    service: new ReportsService(prisma),
    calls,
    rows,
    setOutlet: (value) => {
      outlet = value;
    },
  };
}

function context(role, handler) {
  return {
    getHandler: () => handler,
    getClass: () => ReportsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  };
}

test('Reports MVP', async (t) => {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const outletId = randomUUID();
  const user = { sub: userId, tenant_id: tenantId, role: 'OWNER' };

  await t.test(
    'DTO validates dates, ranges, UUID and defaults limit',
    async () => {
      const daily = plainToInstance(DailySalesQueryDto, {
        date: '2026-09-15',
        outlet_id: outletId,
      });
      assert.equal((await validate(daily)).length, 0);

      for (const input of [
        { start_date: '2026-09-15', end_date: '2026-09-15' },
        { start_date: '2026-09-16', end_date: '2026-09-15' },
        { start_date: '2026-02-30', end_date: '2026-03-02' },
      ]) {
        const dto = plainToInstance(SalesSummaryQueryDto, input);
        assert.ok((await validate(dto)).length > 0);
      }

      const top = plainToInstance(TopProductsQueryDto, {
        start_date: '2026-09-01',
        end_date: '2026-10-01',
      });
      assert.equal((await validate(top)).length, 0);
      assert.equal(top.limit, 10);
    },
  );

  await t.test('RBAC metadata allows OWNER/ADMIN and rejects CASHIER', () => {
    const guard = new RolesGuard(new Reflector());
    const handler = ReportsController.prototype.dailySales;
    assert.equal(guard.canActivate(context('OWNER', handler)), true);
    assert.equal(guard.canActivate(context('ADMIN', handler)), true);
    assert.throws(
      () => guard.canActivate(context('CASHIER', handler)),
      ForbiddenException,
    );
  });

  await t.test(
    'daily report is tenant/outlet scoped and calculates profit',
    async () => {
      const { service, calls, rows, setOutlet } = subject();
      setOutlet({ id: outletId });
      rows.push([
        {
          transaction_count: '2',
          gross_sales: '30000',
          discount: '1000',
          net_sales: '29000',
          tax_collected: '3190',
          total_sales: '32190',
          cogs: '18000',
        },
      ]);

      const result = await service.dailySales(user, {
        date: '2026-09-15',
        outlet_id: outletId,
      });
      assert.deepEqual(result, {
        date: '2026-09-15',
        outlet_id: outletId,
        transaction_count: 2,
        gross_sales: 30000,
        discount: 1000,
        net_sales: 29000,
        tax_collected: 3190,
        total_sales: 32190,
        cogs: 18000,
        gross_profit: 11000,
      });
      assert.deepEqual(calls.actor[0].where, {
        id: userId,
        tenant_id: tenantId,
        is_active: true,
        tenants: { is_active: true },
      });
      assert.deepEqual(calls.outlet[0].where, {
        id: outletId,
        tenant_id: tenantId,
      });
      assert.equal('is_active' in calls.outlet[0].where, false);
      assert.deepEqual(calls.transaction, [
        { isolationLevel: 'RepeatableRead' },
      ]);

      const query = calls.query[0];
      assert.ok(query.values.filter((value) => value === tenantId).length >= 2);
      assert.ok(query.values.includes(outletId));
      assert.ok(query.values.includes('COMPLETED'));
      assert.equal(query.strings.join(' ').includes('payments'), false);
      assert.ok(
        query.values.some(
          (value) =>
            value instanceof Date &&
            value.toISOString() === '2026-09-14T17:00:00.000Z',
        ),
      );
    },
  );

  await t.test(
    'summary uses net sales for rounded average and profit',
    async () => {
      const { service, rows } = subject('ADMIN');
      rows.push([
        {
          transaction_count: '3',
          gross_sales: '31001',
          discount: '1000',
          net_sales: '30001',
          tax_collected: '0',
          total_sales: '30001',
          cogs: '12000',
        },
      ]);
      const result = await service.salesSummary(user, {
        start_date: '2026-09-01',
        end_date: '2026-10-01',
      });
      assert.equal(result.average_transaction, 10000);
      assert.equal(result.gross_profit, 18001);
    },
  );

  await t.test(
    'top products use item snapshots and discounted net sales for profit',
    async () => {
      const { service, calls, rows } = subject();
      const productId = randomUUID();
      rows.push([
        {
          product_id: productId,
          product_name: 'Kopi Susu',
          sku: 'KS-001',
          quantity_sold: '8',
          gross_sales: '160000',
          net_sales: '155000',
          cogs: '80000',
        },
      ]);
      const result = await service.topProducts(user, {
        start_date: '2026-09-01',
        end_date: '2026-10-01',
        limit: 10,
      });
      assert.deepEqual(result, [
        {
          product_id: productId,
          product_name: 'Kopi Susu',
          sku: 'KS-001',
          quantity_sold: 8,
          gross_sales: 160000,
          cogs: 80000,
          gross_profit: 75000,
        },
      ]);
      assert.ok(calls.query[0].values.includes(tenantId));
      assert.ok(calls.query[0].values.includes('COMPLETED'));
      assert.ok(calls.query[0].values.includes(10));
    },
  );

  await t.test(
    'database CASHIER role and foreign outlet are rejected',
    async () => {
      const cashier = subject('CASHIER');
      await assert.rejects(
        cashier.service.dailySales(user, { date: '2026-09-15' }),
        ForbiddenException,
      );
      assert.equal(cashier.calls.query.length, 0);

      const foreign = subject();
      foreign.setOutlet(null);
      await assert.rejects(
        foreign.service.dailySales(user, {
          date: '2026-09-15',
          outlet_id: outletId,
        }),
        NotFoundException,
      );
      assert.equal(foreign.calls.query.length, 0);
    },
  );
});
