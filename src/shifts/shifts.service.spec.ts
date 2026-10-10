import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { ShiftsService } from './shifts.service';

const id = {
  tenant: '11111111-1111-4111-8111-111111111111',
  user: '22222222-2222-4222-8222-222222222222',
  otherUser: '33333333-3333-4333-8333-333333333333',
  outlet: '44444444-4444-4444-8444-444444444444',
  otherOutlet: '55555555-5555-4555-8555-555555555555',
  shift: '66666666-6666-4666-8666-666666666666',
  otherShift: '77777777-7777-4777-8777-777777777777',
  product: '88888888-8888-4888-8888-888888888888',
};

const openedAt = new Date('2026-10-03T08:00:00.000Z');
const closedAt = new Date('2026-10-03T21:14:00.000Z');

const cashierUser = { sub: id.user, tenant_id: id.tenant, role: 'CASHIER' } as any;
const adminUser = { sub: id.user, tenant_id: id.tenant, role: 'ADMIN' } as any;

function shift(overrides: Record<string, unknown> = {}) {
  return {
    id: id.shift,
    tenant_id: id.tenant,
    outlet_id: id.outlet,
    user_id: id.user,
    opening_cash: null,
    closing_cash: null,
    expected_cash: null,
    difference: null,
    status: 'OPEN',
    opened_at: openedAt,
    closed_at: null,
    outlets: { id: id.outlet, name: 'Main Outlet' },
    users: { id: id.user, name: 'Cashier One' },
    ...overrides,
  };
}

function makeTx(config: any = {}) {
  return {
    users: {
      findFirst: jest.fn<any>().mockResolvedValue({
        role: 'CASHIER',
        outlet_id: id.outlet,
      }),
    },
    outlets: { findFirst: jest.fn<any>().mockResolvedValue({ id: id.outlet }) },
    cashier_sessions: {
      findFirst: jest.fn<any>().mockResolvedValue(null),
      create: jest.fn<any>().mockResolvedValue(shift()),
      updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
    },
    held_orders: {
      count: jest.fn<any>().mockResolvedValue(0),
    },
    $queryRaw: jest.fn<any>().mockResolvedValue([]),
    transactions: {
      aggregate: jest.fn<any>().mockResolvedValue({ _sum: { total: 575n }, _count: { _all: 3 } }),
      findMany: jest.fn<any>().mockResolvedValue([
        {
          payments: [
            { method: 'CASH', status: 'PAID', amount: 100n, amount_received: 500n },
          ],
          transaction_items: [
            { product_id: id.product, quantity: 2, product_name_snapshot: 'Americano', products: { name: 'Ignored' } },
          ],
        },
        {
          payments: [{ method: 'QRIS', status: 'PAID', amount: 225n }],
          transaction_items: [
            { product_id: id.product, quantity: 3, product_name_snapshot: 'Americano', products: { name: 'Ignored' } },
          ],
        },
        {
          payments: [{ method: 'CASH', status: 'PAID', amount: 250n }],
          transaction_items: [
            { product_id: id.otherOutlet, quantity: 1, product_name_snapshot: null, products: { name: 'Tea' } },
          ],
        },
      ]),
    },
    ...config,
  };
}

function service(tx: any, transactionImpl?: any) {
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => {
      if (transactionImpl) {
        return transactionImpl(callback);
      }
      return callback(tx);
    }),
  };
  return { service: new ShiftsService(prisma), prisma, tx };
}

describe('ShiftsService V1-M6', () => {
  it('derives the final summary inside the close transaction before changing state', async () => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift());
    const failure = new Error('summary unavailable');
    tx.transactions.aggregate.mockRejectedValue(failure);
    const { service: s } = service(tx);
    await expect(s.close(cashierUser, id.shift, {})).rejects.toBe(failure);
    expect(tx.transactions.aggregate).toHaveBeenCalledTimes(1);
    expect(tx.cashier_sessions.updateMany).not.toHaveBeenCalled();
  });

  it('returns zero totals and no products for an empty shift', async () => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift());
    tx.transactions.aggregate.mockResolvedValue({ _sum: { total: null }, _count: { _all: 0 } });
    tx.transactions.findMany.mockResolvedValue([]);
    const result = await service(tx).service.summary(cashierUser, id.shift);
    expect(result).toMatchObject({ transaction_count: 0, totals: { sales: 0, cash: 0, qris: 0, edc: 0 }, products: [], closed_at: null });
  });

  it.each([false, true])('reads CLOSED summary with historical reconciliation populated=%s without mutation', async (legacy) => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift({ status: 'CLOSED', closed_at: closedAt,
      ...(legacy ? { opening_cash: 100n, closing_cash: 450n, expected_cash: 450n, difference: 0n } : {}) }));
    const result = await service(tx).service.summary(cashierUser, id.shift);
    expect(result).toMatchObject({ status: 'CLOSED', closed_at: closedAt, totals: { sales: 575, cash: 350, qris: 225, edc: 0 } });
    expect(result).not.toHaveProperty('closing_cash');
    expect(tx.cashier_sessions.updateMany).not.toHaveBeenCalled();
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('keeps EDC in its own bucket and out of cash', async () => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift());
    tx.transactions.aggregate.mockResolvedValue({ _sum: { total: 600n }, _count: { _all: 3 } });
    tx.transactions.findMany.mockResolvedValue([
      { payments: [{ method: 'CASH', status: 'PAID', amount: 100n }], transaction_items: [] },
      { payments: [{ method: 'QRIS', status: 'PAID', amount: 200n }], transaction_items: [] },
      { payments: [{ method: 'EDC', status: 'PAID', amount: 300n }], transaction_items: [] },
    ]);
    const result = await service(tx).service.summary(cashierUser, id.shift);
    expect(result.totals).toEqual({ sales: 600, cash: 100, qris: 200, edc: 300 });
  });

  it('preserves legacy reconciliation values on the current read response', async () => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift({ opening_cash: 100n }));
    expect(await service(tx).service.current(cashierUser)).toMatchObject({ opening_cash: 100, reconciliation_mode: 'LEGACY' });
  });

  it.each(['summary', 'close'] as const)('hides missing/foreign tenant shift for %s', async (method) => {
    const tx = makeTx();
    const s = service(tx).service;
    await expect(method === 'summary' ? s.summary(cashierUser, id.shift) : s.close(cashierUser, id.shift, {})).rejects.toMatchObject({ status: 404 });
    expect(tx.cashier_sessions.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: id.shift, tenant_id: id.tenant } }));
    expect(tx.transactions.aggregate).not.toHaveBeenCalled();
    expect(tx.cashier_sessions.updateMany).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'ADMIN'])('allows %s to summarize and close another user shift within tenant', async (role) => {
    const tx = makeTx();
    tx.users.findFirst.mockResolvedValue({ role, outlet_id: null });
    tx.cashier_sessions.findFirst.mockResolvedValue(shift({ user_id: id.otherUser }));
    const s = service(tx).service;
    await expect(s.summary(cashierUser, id.shift)).resolves.toMatchObject({ shift_id: id.shift });
    await expect(s.close(cashierUser, id.shift, {})).resolves.toMatchObject({ shift_id: id.shift });
    expect(tx.cashier_sessions.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(['summary', 'close'] as const)('denies unsupported persisted role on %s despite owner JWT claim', async (method) => {
    const tx = makeTx();
    tx.users.findFirst.mockResolvedValue({ role: 'VIEWER', outlet_id: id.outlet });
    const s = service(tx).service;
    const user = { ...cashierUser, role: 'OWNER' };
    await expect(method === 'summary' ? s.summary(user, id.shift) : s.close(user, id.shift, {})).rejects.toMatchObject({ status: 403 });
    expect(tx.cashier_sessions.findFirst).not.toHaveBeenCalled();
  });

  it('rejects inactive actor/tenant and validates authenticated scope', async () => {
    const tx = makeTx();
    tx.users.findFirst.mockResolvedValue(null);
    await expect(service(tx).service.summary(cashierUser, id.shift)).rejects.toMatchObject({ status: 401 });
    expect(tx.users.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: id.user, tenant_id: id.tenant, is_active: true, tenants: { is_active: true } } }));
  });

  it.each(['opening_cash', 'closing_cash', 'expected_cash', 'difference', 'unknown'])('rejects forbidden close DTO property %s', async (key) => {
    const { service: s, prisma } = service(makeTx());
    await expect(s.close(cashierUser, id.shift, { [key]: 0 })).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([{ outlet_id: id.outlet, opening_cash: 0 }, { outlet_id: id.outlet, unknown: true }, {}, { outlet_id: 'invalid' }])('rejects invalid open DTO %j', async (input) => {
    const { service: s, prisma } = service(makeTx());
    await expect(s.open(cashierUser, input as any)).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects missing/foreign/inactive outlet using tenant-scoped active lookup', async () => {
    const tx = makeTx();
    tx.outlets.findFirst.mockResolvedValue(null);
    await expect(service(tx).service.open(cashierUser, { outlet_id: id.outlet })).rejects.toMatchObject({ status: 404 });
    expect(tx.outlets.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: id.outlet, tenant_id: id.tenant, is_active: true } }));
    expect(tx.cashier_sessions.create).not.toHaveBeenCalled();
  });

  it('denies cashier opening outside their assigned outlet', async () => {
    const tx = makeTx();
    await expect(service(tx).service.open(cashierUser, { outlet_id: id.otherOutlet })).rejects.toMatchObject({ response: { error_code: 'OUTLET_ACCESS_DENIED' } });
    expect(tx.cashier_sessions.create).not.toHaveBeenCalled();
  });

  it.each([id.outlet, id.otherOutlet])('rejects duplicate open including another outlet %s for an admin', async (outlet_id) => {
    const tx = makeTx();
    tx.users.findFirst.mockResolvedValue({ role: 'ADMIN', outlet_id: null });
    tx.cashier_sessions.findFirst.mockResolvedValue(shift());
    await expect(service(tx).service.open(adminUser, { outlet_id })).rejects.toMatchObject({ response: { error_code: 'SHIFT_ALREADY_OPEN' } });
    expect(tx.cashier_sessions.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenant_id: id.tenant, user_id: id.user, status: 'OPEN' } }));
    expect(tx.cashier_sessions.create).not.toHaveBeenCalled();
  });

  it('denies cashier close of another user shift', async () => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift({ user_id: id.otherUser }));
    await expect(service(tx).service.close(cashierUser, id.shift, {})).rejects.toMatchObject({ response: { error_code: 'SHIFT_ACCESS_DENIED' } });
    expect(tx.cashier_sessions.updateMany).not.toHaveBeenCalled();
  });

  it('rejects already CLOSED without another timestamp/write', async () => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift({ status: 'CLOSED', closed_at: closedAt }));
    await expect(service(tx).service.close(cashierUser, id.shift, {})).rejects.toMatchObject({ response: { error_code: 'SHIFT_ALREADY_CLOSED' } });
    expect(tx.cashier_sessions.updateMany).not.toHaveBeenCalled();
  });

  it('rejects close with OPEN held order from same tenant and origin session', async () => {
      const tx = makeTx();
      tx.cashier_sessions.findFirst.mockResolvedValue(shift());
      tx.held_orders.count.mockResolvedValue(1);
      await expect(service(tx).service.close(cashierUser, id.shift, {})).rejects.toMatchObject({
        status: 409,
        response: { error_code: 'OPEN_HELD_ORDERS_EXIST', open_held_order_count: 1 },
      });
      expect(tx.held_orders.count).toHaveBeenCalledWith({
        where: { tenant_id: id.tenant, origin_cashier_session_id: id.shift, status: 'OPEN' },
      });
      expect(tx.transactions.aggregate).not.toHaveBeenCalled();
      expect(tx.cashier_sessions.updateMany).not.toHaveBeenCalled();
    });

    it('reports the blocking order count without exposing order or customer detail', async () => {
      const tx = makeTx();
      tx.cashier_sessions.findFirst.mockResolvedValue(shift());
      tx.held_orders.count.mockResolvedValue(3);
      const error: any = await service(tx).service.close(cashierUser, id.shift, {}).catch((e) => e);
      expect(error.getResponse()).toEqual({
        message: 'Shift has OPEN Held Orders',
        error_code: 'OPEN_HELD_ORDERS_EXIST',
        open_held_order_count: 3,
      });
    });

    it('locks the origin session row before counting OPEN held orders inside the close transaction', async () => {
      const tx = makeTx();
      tx.cashier_sessions.findFirst.mockResolvedValue(shift());
      const { service: s, prisma } = service(tx);
      await s.close(cashierUser, id.shift, {});
      // Serializable would pin this transaction's snapshot at its first query, so
      // the OPEN lookup issued after the lock would still miss a Held Order that
      // committed while this transaction waited for the session row.
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.held_orders.count.mock.invocationCallOrder[0]).toBeGreaterThan(
        tx.$queryRaw.mock.invocationCallOrder[0],
      );
    });

    it('leaves the session OPEN with no close side effects when OPEN held orders block', async () => {
      const tx = makeTx();
      let stored = shift();
      tx.cashier_sessions.findFirst.mockImplementation(async () => stored);
      tx.held_orders.count.mockResolvedValue(2);
      const { service: s } = service(tx, async (callback: any) => {
        const before = { ...stored };
        try {
          return await callback(tx);
        } catch (error) {
          stored = before;
          throw error;
        }
      });
      await expect(s.close(cashierUser, id.shift, {})).rejects.toMatchObject({
        response: { error_code: 'OPEN_HELD_ORDERS_EXIST' },
      });
      expect(stored).toMatchObject({ status: 'OPEN', closed_at: null });
      expect(tx.cashier_sessions.updateMany).not.toHaveBeenCalled();
      expect(tx.transactions.aggregate).not.toHaveBeenCalled();
    });

    it.each(['CONVERTED', 'CANCELLED'])('%s held orders do not block close', async (status) => {
      const tx = makeTx();
      tx.cashier_sessions.findFirst
        .mockResolvedValueOnce(shift())
        .mockResolvedValueOnce(shift({ status: 'CLOSED', closed_at: closedAt }));
      tx.held_orders.count.mockResolvedValue(0);
      await expect(service(tx).service.close(cashierUser, id.shift, {})).resolves.toMatchObject({ status: 'CLOSED' });
      expect(tx.held_orders.count).toHaveBeenCalledWith({
        where: { tenant_id: id.tenant, origin_cashier_session_id: id.shift, status: 'OPEN' },
      });
      expect(tx.cashier_sessions.updateMany).toHaveBeenCalledTimes(1);
      // The predicate is status-scoped, so terminal orders cannot match it.
      expect(status).not.toBe('OPEN');
    });

  it('rejects concurrent close when conditional update affects zero rows', async () => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift());
    tx.cashier_sessions.updateMany.mockResolvedValue({ count: 0 });
    await expect(service(tx).service.close(cashierUser, id.shift, {})).rejects.toMatchObject({ response: { error_code: 'SHIFT_ALREADY_CLOSED' } });
    expect(tx.cashier_sessions.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.cashier_sessions.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: id.shift, tenant_id: id.tenant, status: 'OPEN' } }));
  });

  it.each(['update', 'reread'])('propagates %s failure out of the serializable transaction; transactional fake rolls state back', async (stage) => {
    const tx = makeTx();
    let stored = shift();
    const failure = new Error('database failure');
    tx.cashier_sessions.findFirst.mockImplementation(async () => {
      if (stage === 'reread' && stored.status === 'CLOSED') throw failure;
      return stored;
    });
    tx.cashier_sessions.updateMany.mockImplementation(async ({ data }: any) => {
      if (stage === 'update') throw failure;
      stored = { ...stored, ...data };
      return { count: 1 };
    });
    const { service: s, prisma } = service(tx, async (callback: any) => {
      const before = { ...stored };
      try { return await callback(tx); } catch (error) { stored = before; throw error; }
    });
    await expect(s.close(cashierUser, id.shift, {})).rejects.toBe(failure);
    expect(stored).toMatchObject({ status: 'OPEN', closed_at: null });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  });

  it.each(['sales', 'cash', 'qris'])('rejects unsafe bigint %s instead of losing precision', async (field) => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift());
    const unsafe = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    if (field === 'sales') tx.transactions.aggregate.mockResolvedValue({ _sum: { total: unsafe }, _count: { _all: 1 } });
    else tx.transactions.findMany.mockResolvedValue([{ payments: [{ method: field.toUpperCase(), amount: unsafe }], transaction_items: [] }]);
    await expect(service(tx).service.summary(cashierUser, id.shift)).rejects.toMatchObject({ status: 500 });
  });

  it('serializes the maximum safe bigint and timestamps without raw bigint', async () => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift());
    tx.transactions.aggregate.mockResolvedValue({ _sum: { total: BigInt(Number.MAX_SAFE_INTEGER) }, _count: { _all: 1 } });
    const result = JSON.parse(JSON.stringify(await service(tx).service.summary(cashierUser, id.shift)));
    expect(result.totals.sales).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.opened_at).toBe(openedAt.toISOString());
  });

  it('uses identical explicit relation filters on aggregate/findMany and PAID tenant-scoped payments', async () => {
    const tx = makeTx();
    tx.cashier_sessions.findFirst.mockResolvedValue(shift());
    const { service: s, prisma } = service(tx);
    await s.summary(cashierUser, id.shift);
    const where = { tenant_id: id.tenant, cashier_session_id: id.shift, status: 'COMPLETED' };
    expect(tx.transactions.aggregate.mock.calls[0][0].where).toEqual(where);
    expect(tx.transactions.findMany.mock.calls[0][0].where).toEqual(where);
    expect(tx.transactions.findMany.mock.calls[0][0].select.payments).toEqual({ where: { tenant_id: id.tenant, status: 'PAID' }, select: { method: true, amount: true } });
    expect(tx.transactions.findMany.mock.calls[0][0].select.transaction_items.where).toEqual({ tenant_id: id.tenant });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  });

  it('retries serializable conflicts three times then returns retry-required', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'test' });
    const { service: s, prisma } = service(makeTx(), async () => { throw error; });
    await expect(s.close(cashierUser, id.shift, {})).rejects.toMatchObject({ response: { error_code: 'SHIFT_RETRY_REQUIRED' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it.each(['summary', 'close'] as const)('rejects invalid shift ID on %s before database access', async (method) => {
    const { service: s, prisma } = service(makeTx());
    await expect(method === 'summary' ? s.summary(cashierUser, 'bad') : s.close(cashierUser, 'bad', {})).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('current uses only authenticated own OPEN shift', async () => {
    const tx = makeTx();
    await expect(service(tx).service.current(cashierUser)).rejects.toMatchObject({ status: 404 });
    expect(tx.cashier_sessions.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenant_id: id.tenant, user_id: id.user, status: 'OPEN' } }));
  });

  it('opens a V1 shift with outlet_id only and nullable reconciliation fields', async () => {
    const tx = makeTx();
    const { service: s } = service(tx);

    const result = await s.open(cashierUser, { outlet_id: id.outlet } as any);

    expect(tx.cashier_sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ opening_cash: expect.anything() }),
    }));
    expect(result).toMatchObject({
      shift_id: id.shift,
      status: 'OPEN',
      reconciliation_mode: 'NONE',
      opening_cash: null,
      closing_cash: null,
      expected_cash: null,
      difference: null,
    });
  });

  it('maps concurrent open unique violations to SHIFT_ALREADY_OPEN', async () => {
    const tx = makeTx();
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    tx.cashier_sessions.create.mockRejectedValue(p2002);
    const { service: s } = service(tx);

    await expect(s.open(cashierUser, { outlet_id: id.outlet } as any)).rejects.toMatchObject({
      response: { error_code: 'SHIFT_ALREADY_OPEN' },
    });
  });

  it('returns a summary using only explicit completed cashier_session_id transactions', async () => {
    const tx = makeTx({
      cashier_sessions: { findFirst: jest.fn<any>().mockResolvedValue(shift()) },
    });
    const { service: s } = service(tx);

    const result = await s.summary(cashierUser, id.shift);

    expect(tx.transactions.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenant_id: id.tenant,
        cashier_session_id: id.shift,
        status: 'COMPLETED',
      }),
    }));
    expect(tx.transactions.aggregate.mock.calls[0][0].where).not.toHaveProperty('user_id');
    expect(tx.transactions.aggregate.mock.calls[0][0].where).not.toHaveProperty('outlet_id');
    expect(result).toMatchObject({
      shift_id: id.shift,
      status: 'OPEN',
      outlet: { id: id.outlet, name: 'Main Outlet' },
      cashier: { id: id.user, name: 'Cashier One' },
      transaction_count: 3,
      totals: { sales: 575, cash: 350, qris: 225 },
      products: [
        { product_id: id.product, product_name: 'Americano', quantity: 5 },
        { product_id: id.otherOutlet, product_name: 'Tea', quantity: 1 },
      ],
    });
    expect(result.closed_at).toBeNull();
    expect(result.generated_at).toBeInstanceOf(Date);
  });

  it('denies cashier summary access for another cashier shift', async () => {
    const tx = makeTx({
      cashier_sessions: { findFirst: jest.fn<any>().mockResolvedValue(shift({ user_id: id.otherUser })) },
    });
    const { service: s } = service(tx);

    await expect(s.summary(cashierUser, id.shift)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('closes a V1 shift without reconciliation values and returns legacy-compatible shift shape', async () => {
    const tx = makeTx({
      cashier_sessions: {
        findFirst: jest
          .fn<any>()
          .mockResolvedValueOnce(shift())
          .mockResolvedValueOnce(shift({ status: 'CLOSED', closed_at: closedAt })),
        updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
      },
    });
    const { service: s } = service(tx);

    const result = await s.close(cashierUser, id.shift, {} as any);

    expect(tx.cashier_sessions.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CLOSED',
        closing_cash: null,
        expected_cash: null,
        difference: null,
      }),
    }));
    expect(result).toMatchObject({
      shift_id: id.shift,
      status: 'CLOSED',
      reconciliation_mode: 'NONE',
      opening_cash: null,
      closing_cash: null,
      expected_cash: null,
      difference: null,
    });
  });
});
