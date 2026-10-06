import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { HeldOrdersService } from './held-orders.service';

const id = {
  tenant: '11111111-1111-4111-8111-111111111111',
  user: '22222222-2222-4222-8222-222222222222',
  outlet: '33333333-3333-4333-8333-333333333333',
  otherOutlet: '33333333-3333-4333-8333-333333333334',
  session: '44444444-4444-4444-8444-444444444444',
  order: '55555555-5555-4555-8555-555555555555',
  product: '66666666-6666-4666-8666-666666666666',
  group: '77777777-7777-4777-8777-777777777777',
  option: '88888888-8888-4888-8888-888888888888',
  item: '99999999-9999-4999-8999-999999999999',
};
const user = { sub: id.user, tenant_id: id.tenant, role: 'CASHIER' } as any;
const now = new Date('2026-10-07T00:00:00.000Z');

function input(overrides: Record<string, unknown> = {}) {
  return {
    outlet_id: id.outlet,
    cashier_session_id: id.session,
    label: ' Meja 4 ',
    items: [{ product_id: id.product, quantity: 2, modifier_option_ids: [id.option], note: ' less ice ' }],
    ...overrides,
  } as any;
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: id.order,
    tenant_id: id.tenant,
    outlet_id: id.outlet,
    origin_cashier_session_id: id.session,
    cashier_user_id: id.user,
    label: 'Meja 4',
    status: 'OPEN',
    version: 1,
    subtotal_estimate: 300n,
    tax_estimate: 0n,
    total_estimate: 300n,
    converted_transaction_id: null,
    created_at: now,
    updated_at: now,
    cancelled_at: null,
    converted_at: null,
    users: { id: id.user, name: 'Cashier' },
    held_order_items: [{
      id: id.item,
      product_id: id.product,
      quantity: 2,
      product_name_snapshot: 'Coffee',
      sku_snapshot: 'COF',
      base_price_snapshot: 100n,
      effective_price_snapshot: 150n,
      note_snapshot: 'less ice',
      display_order: 0,
      held_order_item_modifiers: [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        modifier_group_id: id.group,
        modifier_option_id: id.option,
        group_name_snapshot: 'Size',
        option_name_snapshot: 'Large',
        price_delta_snapshot: 50,
      }],
    }],
    ...overrides,
  };
}

function makeTx() {
  return {
    users: { findFirst: jest.fn<any>().mockResolvedValue({ role: 'CASHIER', outlet_id: id.outlet }) },
    tenants: { findFirst: jest.fn<any>().mockResolvedValue({ tax_enabled: false, tax_rate: 0 }) },
    outlets: { findFirst: jest.fn<any>().mockResolvedValue({ id: id.outlet }) },
    cashier_sessions: { findFirst: jest.fn<any>().mockResolvedValue({ id: id.session, outlet_id: id.outlet }) },
    products: { findMany: jest.fn<any>().mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100 }]) },
    product_modifier_groups: { findMany: jest.fn<any>().mockResolvedValue([{ product_id: id.product, modifier_group_id: id.group, required: true, selection_type: 'SINGLE', modifier_groups: { name: 'Size' } }]) },
    modifier_options: { findMany: jest.fn<any>().mockResolvedValue([{ id: id.option, modifier_group_id: id.group, name: 'Large', price_delta: 50 }]) },
    held_orders: {
      create: jest.fn<any>().mockResolvedValue({ id: id.order }),
      findFirst: jest.fn<any>().mockResolvedValue(order()),
      findMany: jest.fn<any>().mockResolvedValue([order()]),
      count: jest.fn<any>().mockResolvedValue(1),
      updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
    },
    held_order_items: {
      create: jest.fn<any>().mockResolvedValue({ id: id.item }),
      deleteMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
    },
    held_order_item_modifiers: { createMany: jest.fn<any>().mockResolvedValue({ count: 1 }) },
    transactions: { create: jest.fn(), update: jest.fn() },
    payments: { create: jest.fn() },
    product_stocks: { updateMany: jest.fn() },
    stock_movements: { createMany: jest.fn() },
  };
}

function service(tx = makeTx()) {
  const prisma: any = { $transaction: jest.fn(async (callback: any) => callback(tx)) };
  return { service: new HeldOrdersService(prisma), prisma, tx };
}

describe('HeldOrdersService M16A', () => {
  it('creates an OPEN draft with authoritative estimates and normalized snapshots without sale side effects', async () => {
    const { service: subject, tx } = service();
    const result = await subject.create(user, input());

    expect(tx.held_orders.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenant_id: id.tenant,
      outlet_id: id.outlet,
      origin_cashier_session_id: id.session,
      cashier_user_id: id.user,
      label: 'Meja 4',
      status: 'OPEN',
      version: 1,
      subtotal_estimate: 300n,
      total_estimate: 300n,
    }) }));
    expect(tx.held_order_items.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      product_name_snapshot: 'Coffee', sku_snapshot: 'COF', base_price_snapshot: 100n,
      effective_price_snapshot: 150n, note_snapshot: 'less ice', display_order: 0,
    }) }));
    expect(tx.held_order_item_modifiers.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      modifier_group_id: id.group, modifier_option_id: id.option,
      group_name_snapshot: 'Size', option_name_snapshot: 'Large', price_delta_snapshot: 50,
    })] });
    expect(result).toMatchObject({ held_order_id: id.order, subtotal_estimate: 300, total_estimate: 300, item_count: 2 });
    expect(tx.transactions.create).not.toHaveBeenCalled();
    expect(tx.payments.create).not.toHaveBeenCalled();
    expect(tx.product_stocks.updateMany).not.toHaveBeenCalled();
    expect(tx.stock_movements.createMany).not.toHaveBeenCalled();
  });

  it('rejects inactive products with HELD_ORDER_CATALOG_CONFLICT before writes', async () => {
    const tx = makeTx();
    tx.products.findMany.mockResolvedValue([]);
    const { service: subject } = service(tx);
    await expect(subject.create(user, input())).rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_CATALOG_CONFLICT' } });
    expect(tx.held_orders.create).not.toHaveBeenCalled();
  });

  it('reuses modifier validation semantics for unassigned and required modifier failures', async () => {
    const unassigned = makeTx();
    unassigned.product_modifier_groups.findMany.mockResolvedValue([]);
    await expect(service(unassigned).service.create(user, input())).rejects.toMatchObject({ response: { error_code: 'MODIFIER_GROUP_NOT_ASSIGNED' } });

    const missing = makeTx();
    await expect(service(missing).service.create(user, input({ items: [{ product_id: id.product, quantity: 1 }] })))
      .rejects.toMatchObject({ response: { error_code: 'REQUIRED_SINGLE_MODIFIER_MISSING' } });
  });

  it('rejects duplicate modifier option IDs for direct service callers before opening a transaction', async () => {
    const { service: subject, prisma, tx } = service();
    await expect(subject.create(user, input({
      items: [{ product_id: id.product, quantity: 1, modifier_option_ids: [id.option, id.option.toUpperCase()] }],
    }))).rejects.toMatchObject({ response: { error_code: 'INVALID_HELD_ORDER_INPUT' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.held_orders.create).not.toHaveBeenCalled();
  });

  it('rejects another actor session and cashier outlet', async () => {
    const sessionTx = makeTx();
    sessionTx.cashier_sessions.findFirst.mockResolvedValue(null);
    await expect(service(sessionTx).service.create(user, input())).rejects.toMatchObject({ response: { error_code: 'INVALID_CASHIER_SESSION' } });

    const outletTx = makeTx();
    await expect(service(outletTx).service.create(user, input({ outlet_id: id.otherOutlet })))
      .rejects.toMatchObject({ response: { error_code: 'OUTLET_ACCESS_DENIED' } });
  });

  it('lists OPEN orders by default with tenant and cashier outlet scope', async () => {
    const { service: subject, tx } = service();
    const result = await subject.findAll(user, { page: 1, limit: 20 } as any);
    expect(tx.held_orders.count).toHaveBeenCalledWith({ where: { tenant_id: id.tenant, outlet_id: id.outlet, status: 'OPEN' } });
    expect(result).toMatchObject({ data: [{ held_order_id: id.order, item_count: 2 }], meta: { total: 1 } });
  });

  it('returns normalized item and modifier snapshots from detail', async () => {
    const result = await service().service.findOne(user, id.order);
    expect(result.items[0]).toMatchObject({ product_id: id.product, note: 'less ice', modifiers: [{ modifier_option_id: id.option, option_name: 'Large' }] });
  });

  it('edits items atomically, recomputes estimates, preserves duplicate lines, and increments version', async () => {
    const { service: subject, tx } = service();
    const result = await subject.update(user, id.order, {
      expected_version: 1,
      items: [
        { product_id: id.product, quantity: 1, modifier_option_ids: [id.option], note: 'one' },
        { product_id: id.product, quantity: 2, modifier_option_ids: [id.option], note: 'two' },
      ],
    } as any);
    expect(tx.held_order_items.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: id.tenant, held_order_id: id.order } });
    expect(tx.held_order_items.create).toHaveBeenCalledTimes(2);
    expect(tx.held_orders.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: id.order, tenant_id: id.tenant, status: 'OPEN', version: 1 },
      data: expect.objectContaining({ version: { increment: 1 }, subtotal_estimate: 450n, total_estimate: 450n }),
    }));
    expect(result.version).toBe(1);
  });

  it('rejects stale edit and terminal-state edit without replacing items', async () => {
    const stale = makeTx();
    stale.held_orders.findFirst.mockResolvedValue(order({ version: 2 }));
    await expect(service(stale).service.update(user, id.order, { expected_version: 1, label: 'new' } as any))
      .rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_VERSION_CONFLICT' } });
    expect(stale.held_order_items.deleteMany).not.toHaveBeenCalled();

    const cancelled = makeTx();
    cancelled.held_orders.findFirst.mockResolvedValue(order({ status: 'CANCELLED' }));
    await expect(service(cancelled).service.update(user, id.order, { expected_version: 1, label: 'new' } as any))
      .rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_NOT_OPEN' } });
  });

  it('cancels with compare-and-set, sets cancelled_at, and rejects stale/cancel-twice', async () => {
    const { service: subject, tx } = service();
    await subject.cancel(user, id.order, { expected_version: 1 } as any);
    expect(tx.held_orders.updateMany).toHaveBeenCalledWith({
      where: { id: id.order, tenant_id: id.tenant, status: 'OPEN', version: 1 },
      data: { status: 'CANCELLED', cancelled_at: expect.any(Date), version: { increment: 1 } },
    });

    const stale = makeTx();
    stale.held_orders.updateMany.mockResolvedValue({ count: 0 });
    await expect(service(stale).service.cancel(user, id.order, { expected_version: 1 } as any)).rejects.toBeInstanceOf(ConflictException);

    const twice = makeTx();
    twice.held_orders.findFirst.mockResolvedValue(order({ status: 'CANCELLED' }));
    await expect(service(twice).service.cancel(user, id.order, { expected_version: 1 } as any))
      .rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_NOT_OPEN' } });
  });

  it('hides cross-tenant records and denies cashier access outside the assigned outlet', async () => {
    const hidden = makeTx();
    hidden.held_orders.findFirst.mockResolvedValue(null);
    await expect(service(hidden).service.findOne(user, id.order)).rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_NOT_FOUND' } });

    const denied = makeTx();
    await expect(service(denied).service.findAll(user, { outlet_id: id.otherOutlet, page: 1, limit: 20 } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets OWNER and ADMIN read another outlet in the same tenant but never another tenant', async () => {
    for (const role of ['OWNER', 'ADMIN']) {
      const tx = makeTx();
      tx.users.findFirst.mockResolvedValue({ role, outlet_id: id.outlet });
      tx.outlets.findFirst.mockResolvedValue({ id: id.otherOutlet });
      await service(tx).service.findAll({ ...user, role } as any, { outlet_id: id.otherOutlet, page: 1, limit: 20 } as any);
      expect(tx.held_orders.count).toHaveBeenCalledWith({ where: { tenant_id: id.tenant, outlet_id: id.otherOutlet, status: 'OPEN' } });

      const foreign = makeTx();
      foreign.users.findFirst.mockResolvedValue({ role, outlet_id: id.outlet });
      foreign.outlets.findFirst.mockResolvedValue(null);
      await expect(service(foreign).service.findAll({ ...user, role } as any, { outlet_id: id.otherOutlet, page: 1, limit: 20 } as any))
        .rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('refuses a role outside OWNER, ADMIN and CASHIER', async () => {
    const tx = makeTx();
    tx.users.findFirst.mockResolvedValue({ role: 'AUDITOR', outlet_id: id.outlet });
    await expect(service(tx).service.findAll(user, { page: 1, limit: 20 } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets only one of two concurrent edits with the same expected_version win', async () => {
    const tx = makeTx();
    const { service: subject } = service(tx);
    await subject.update(user, id.order, { expected_version: 1, label: 'first' } as any);

    tx.held_orders.findFirst.mockResolvedValue(order({ version: 1 }));
    tx.held_orders.updateMany.mockResolvedValue({ count: 0 });
    await expect(subject.update(user, id.order, { expected_version: 1, label: 'second' } as any))
      .rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_VERSION_CONFLICT' } });
  });

  it('lets only one of a concurrent edit and cancel with the same expected_version win', async () => {
    const tx = makeTx();
    const { service: subject } = service(tx);
    await subject.cancel(user, id.order, { expected_version: 1 } as any);

    tx.held_orders.updateMany.mockResolvedValue({ count: 0 });
    await expect(subject.update(user, id.order, { expected_version: 1, label: 'racing edit' } as any))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.held_order_items.deleteMany).not.toHaveBeenCalled();
  });

  it('creates no sale side effect when editing or cancelling', async () => {
    const tx = makeTx();
    const { service: subject } = service(tx);
    await subject.update(user, id.order, { expected_version: 1, items: [{ product_id: id.product, quantity: 1, modifier_option_ids: [id.option] }] } as any);
    await subject.cancel(user, id.order, { expected_version: 1 } as any);
    for (const mocks of [
      [tx.transactions.create, tx.transactions.update],
      [tx.payments.create],
      [tx.product_stocks.updateMany],
      [tx.stock_movements.createMany],
    ]) {
      for (const mock of mocks) expect(mock).not.toHaveBeenCalled();
    }
  });

  it('prices tax like TransactionsService for an enabled decimal tax rate', async () => {
    const tx = makeTx();
    tx.tenants.findFirst.mockResolvedValue({ tax_enabled: true, tax_rate: { toFixed: (places: number) => (places === 2 ? '11.00' : '11') } });
    tx.product_modifier_groups.findMany.mockResolvedValue([]);
    tx.modifier_options.findMany.mockResolvedValue([]);
    const { service: subject } = service(tx);
    const result = await subject.create(user, input({ items: [{ product_id: id.product, quantity: 3 }] }));
    // subtotal 300, tax = 300 * 1100bp / 10000 rounded half-up = 33, total 333
    expect(tx.held_orders.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      subtotal_estimate: 300n, tax_estimate: 33n, total_estimate: 333n,
    }) }));
    expect(result.held_order_id).toBe(id.order);
  });

  it('rejects a line total that cannot be represented before writing items', async () => {
    const tx = makeTx();
    tx.products.findMany.mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 92233720368547758 }]);
    tx.product_modifier_groups.findMany.mockResolvedValue([]);
    const { service: subject } = service(tx);
    await expect(subject.create(user, input({ items: [{ product_id: id.product, quantity: 4 }] })))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.held_orders.create).not.toHaveBeenCalled();
    expect(tx.held_order_items.create).not.toHaveBeenCalled();
  });
});
