import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { PaymentMethod } from './types/transaction.types';

const id = {
  user: '11111111-1111-4111-8111-111111111111', tenant: '22222222-2222-4222-8222-222222222222', outlet: '33333333-3333-4333-8333-333333333333',
  session: '44444444-4444-4444-8444-444444444444', client: '55555555-5555-4555-8555-555555555555', product: '66666666-6666-4666-8666-666666666666',
  option: '77777777-7777-4777-8777-777777777777', group: '88888888-8888-4888-8888-888888888888', customer: '99999999-9999-4999-8999-999999999999',
};
const user = { sub: id.user, tenant_id: id.tenant, role: 'CASHIER', outlet_id: id.outlet };

function input(overrides: Record<string, unknown> = {}) {
  return { client_transaction_id: id.client, outlet_id: id.outlet, cashier_session_id: id.session,
    items: [{ product_id: id.product, quantity: 2, modifier_option_ids: [id.option], note: '  less ice  ' }],
    payment: { method: PaymentMethod.CASH, amount: 500 }, ...overrides } as any;
}
function response(overrides: any = {}) {
  return { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client_transaction_id: id.client, outlet_id: id.outlet, user_id: id.user,
    customer_id: null, status: 'COMPLETED', subtotal: 300n, discount: 0n, tax: 0n, total: 300n, created_at: new Date(), cashier_session_id: id.session,
    transaction_items: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', product_id: id.product, quantity: 2, unit_price: 150n, unit_cost: 50n, subtotal: 300n,
      product_name_snapshot: 'Coffee', sku_snapshot: 'COF', base_price_snapshot: 100n, effective_price_snapshot: 150n, note_snapshot: 'less ice', transaction_item_modifiers: [{ id: 'm', modifier_group_id: id.group, modifier_option_id: id.option, group_name_snapshot: 'Size', option_name_snapshot: 'Large', price_delta_snapshot: 50 }] }],
    payments: [{ id: 'p', method: 'CASH', status: 'PAID', amount: 500n, paid_at: new Date() }], ...overrides };
}
function makeTx(config: any = {}) {
  const tx: any = {
    users: { findFirst: jest.fn<any>().mockResolvedValue({ outlet_id: id.outlet, role: 'CASHIER' }) },
    tenants: { findFirst: jest.fn<any>().mockResolvedValue({ tax_enabled: false, tax_rate: 0 }) },
    transactions: { findFirst: jest.fn<any>().mockResolvedValue(null), create: jest.fn<any>().mockResolvedValue({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), update: jest.fn<any>().mockResolvedValue(response()) },
    cashier_sessions: { findFirst: jest.fn<any>().mockResolvedValue({ id: id.session, outlet_id: id.outlet }) },
    outlets: { findFirst: jest.fn<any>().mockResolvedValue({ id: id.outlet }) }, customers: { findFirst: jest.fn<any>().mockResolvedValue({ id: id.customer }) },
    products: { findMany: jest.fn<any>().mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 50, track_stock: false }]) },
    product_modifier_groups: { findMany: jest.fn<any>().mockResolvedValue([{ product_id: id.product, modifier_group_id: id.group, required: true, selection_type: 'SINGLE', modifier_groups: { name: 'Size' } }]) },
    modifier_options: { findMany: jest.fn<any>().mockResolvedValue([{ id: id.option, modifier_group_id: id.group, name: 'Large', price_delta: 50 }]) },
    modifier_groups: { findMany: jest.fn<any>().mockResolvedValue([{ id: id.group, name: 'Size' }]) },
    transaction_items: { create: jest.fn<any>().mockResolvedValue({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }) }, transaction_item_modifiers: { createMany: jest.fn() },
    product_stocks: { updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }) }, stock_movements: { createMany: jest.fn() }, payments: { create: jest.fn() },
    ...config,
  };
  return tx;
}
function service(tx: any) { const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) }; return { service: new TransactionsService(prisma), prisma, tx }; }

 describe('TransactionsService V1-M4 create', () => {
  it('prices modifiers, snapshots names/prices/note, and persists payment', async () => {
    const { service: s, tx } = service(makeTx()); const result = await s.create(user as any, input());
    expect(result.total).toBe(300); expect(tx.transactions.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subtotal: 300n, total: 300n }) }));
    expect(tx.transaction_items.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ unit_price: 150n, base_price_snapshot: 100n, effective_price_snapshot: 150n, note_snapshot: 'less ice' }) }));
    expect(tx.transaction_item_modifiers.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ group_name_snapshot: 'Size', option_name_snapshot: 'Large', price_delta_snapshot: 50 })] }));
  });
  it('allows duplicate product lines and preserves null note', async () => {
    const tx = makeTx(); tx.product_modifier_groups.findMany.mockResolvedValue([]); const { service: s } = service(tx);
    const result = await s.create(user as any, input({ items: [{ product_id: id.product, quantity: 1, modifier_option_ids: [], note: 'one' }, { product_id: id.product, quantity: 1, modifier_option_ids: [] }] , payment: { method: 'CASH', amount: 300 }}));
    expect(result).toBeDefined(); expect(tx.transaction_items.create).toHaveBeenCalledTimes(2); expect(tx.transaction_items.create.mock.calls[1][0].data.note_snapshot).toBeNull();
  });
  it('rejects a missing required SINGLE selection before any writes', async () => {
    const tx = makeTx(); const { service: s } = service(tx);
    await expect(s.create(user as any, input({ items: [{ product_id: id.product, quantity: 1, modifier_option_ids: [] }] })))
      .rejects.toMatchObject({ response: { error_code: 'REQUIRED_SINGLE_MODIFIER_MISSING' } });
    expect(tx.transactions.create).not.toHaveBeenCalled();
  });
  it('rejects two distinct options from an optional SINGLE group', async () => {
    const second = '77777777-7777-4777-8777-777777777778'; const tx = makeTx();
    tx.product_modifier_groups.findMany.mockResolvedValue([{ product_id: id.product, modifier_group_id: id.group, required: false, selection_type: 'SINGLE', modifier_groups: { name: 'Size' } }]);
    tx.modifier_options.findMany.mockResolvedValue([{ id: id.option, modifier_group_id: id.group, name: 'Large', price_delta: 50 }, { id: second, modifier_group_id: id.group, name: 'Small', price_delta: 0 }]);
    const { service: s } = service(tx);
    await expect(s.create(user as any, input({ items: [{ product_id: id.product, quantity: 1, modifier_option_ids: [id.option, second] }] })))
      .rejects.toMatchObject({ response: { error_code: 'OPTIONAL_SINGLE_MODIFIER_VIOLATION' } });
    expect(tx.transactions.create).not.toHaveBeenCalled();
  });
  it('rejects a modifier when its validated group name is unavailable for the snapshot', async () => {
    const tx = makeTx();
    tx.product_modifier_groups.findMany.mockResolvedValue([{ product_id: id.product, modifier_group_id: id.group, required: true, selection_type: 'SINGLE', modifier_groups: null }]);
    const { service: s } = service(tx);
    await expect(s.create(user as any, input())).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(tx.transactions.create).not.toHaveBeenCalled();
    expect(tx.transaction_item_modifiers.createMany).not.toHaveBeenCalled();
  });
  it('aggregates duplicate tracked-product quantities before the atomic stock predicate', async () => {
    const tx = makeTx();
    tx.product_modifier_groups.findMany.mockResolvedValue([]);
    tx.products.findMany.mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 50, track_stock: true }]);
    tx.product_stocks.updateMany.mockResolvedValue({ count: 0 });
    const { service: s } = service(tx);
    await expect(s.create(user as any, input({
      items: [{ product_id: id.product, quantity: 3 }, { product_id: id.product, quantity: 3 }],
      payment: { method: PaymentMethod.CASH, amount: 600 },
    }))).rejects.toMatchObject({ response: { error_code: 'INSUFFICIENT_STOCK' } });
    expect(tx.product_stocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stock: { gte: 6 } }),
      data: expect.objectContaining({ stock: { decrement: 6 } }),
    }));
    expect(tx.transactions.create).toHaveBeenCalledTimes(1);
    expect(tx.stock_movements.createMany).not.toHaveBeenCalled();
  });
  it('decrements aggregated duplicate tracked-product quantity and records one total movement', async () => {
    const tx = makeTx();
    tx.product_modifier_groups.findMany.mockResolvedValue([]);
    tx.products.findMany.mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 50, track_stock: true }]);
    tx.product_stocks.updateMany.mockResolvedValue({ count: 1 });
    const { service: s } = service(tx);
    await s.create(user as any, input({
      items: [{ product_id: id.product, quantity: 3 }, { product_id: id.product, quantity: 3 }],
      payment: { method: PaymentMethod.CASH, amount: 600 },
    }));
    expect(tx.product_stocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stock: { gte: 6 } }),
      data: expect.objectContaining({ stock: { decrement: 6 } }),
    }));
    expect(tx.stock_movements.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ product_id: id.product, quantity: -6 })] });
  });
  it('rejects duplicate tracked-product stock before movements and later side effects', async () => {
    const tx = makeTx();
    tx.product_modifier_groups.findMany.mockResolvedValue([]);
    tx.products.findMany.mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 50, track_stock: true }]);
    tx.product_stocks.updateMany.mockResolvedValue({ count: 0 });
    const { service: s } = service(tx);
    await expect(s.create(user as any, input({
      items: [{ product_id: id.product, quantity: 3 }, { product_id: id.product, quantity: 3 }],
      payment: { method: PaymentMethod.CASH, amount: 600 },
    }))).rejects.toBeInstanceOf(ConflictException);
    expect(tx.transaction_item_modifiers.createMany).not.toHaveBeenCalled();
    expect(tx.stock_movements.createMany).not.toHaveBeenCalled();
    expect(tx.payments.create).not.toHaveBeenCalled();
  });
  it('rejects inactive or cross-tenant options excluded by the scoped lookup', async () => {
    const tx = makeTx(); tx.modifier_options.findMany.mockResolvedValue([]); const { service: s } = service(tx);
    await expect(s.create(user as any, input())).rejects.toMatchObject({ response: { error_code: 'MODIFIER_OPTION_NOT_FOUND' } });
    expect(tx.modifier_options.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenant_id: id.tenant, is_active: true }) }));
    expect(tx.transactions.create).not.toHaveBeenCalled();
  });
  it('rejects an unassigned modifier and inactive/missing product', async () => {
    const unassigned = makeTx(); unassigned.product_modifier_groups.findMany.mockResolvedValue([]); const { service: a } = service(unassigned);
    await expect(a.create(user as any, input())).rejects.toBeInstanceOf(BadRequestException);
    const missing = makeTx(); missing.products.findMany.mockResolvedValue([]); const { service: b } = service(missing);
    await expect(b.create(user as any, input())).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects invalid required fields and tenant/user context', async () => {
    const { service: s } = service(makeTx()); await expect(s.create(user as any, input({ payment: { method: 'CASH' } }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.create({ ...user, tenant_id: 'not-a-uuid' } as any, input())).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rolls back on insufficient stock and does not create movement', async () => {
    const tx = makeTx(); tx.products.findMany.mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 50, track_stock: true }]); tx.product_stocks.updateMany.mockResolvedValue({ count: 0 });
    const { service: s } = service(tx); await expect(s.create(user as any, input())).rejects.toBeInstanceOf(ConflictException); expect(tx.stock_movements.createMany).not.toHaveBeenCalled();
  });
  it('returns the existing transaction for an identical idempotent retry', async () => {
    const tx = makeTx(); const existing = response(); tx.transactions.findFirst.mockResolvedValue(existing); const { service: s } = service(tx);
    await expect(s.create(user as any, input())).resolves.toMatchObject({ transaction_id: existing.id });
    expect(tx.transactions.create).not.toHaveBeenCalled();
    expect(tx.transaction_items.create).not.toHaveBeenCalled();
    expect(tx.transaction_item_modifiers.createMany).not.toHaveBeenCalled();
    expect(tx.product_stocks.updateMany).not.toHaveBeenCalled();
    expect(tx.stock_movements.createMany).not.toHaveBeenCalled();
  });
  it('rejects an idempotency payload mismatch', async () => {
    const tx = makeTx(); tx.transactions.findFirst.mockResolvedValue(response()); const { service: s } = service(tx);
    await expect(s.create(user as any, input({ items: [{ product_id: id.product, quantity: 9, modifier_option_ids: [id.option] }] }))).rejects.toBeInstanceOf(ConflictException);
  });
  it.each([
    ['session', { cashier_session_id: '44444444-4444-4444-8444-444444444445' }],
    ['quantity', { items: [{ product_id: id.product, quantity: 3, modifier_option_ids: [id.option], note: 'less ice' }] }],
    ['modifiers', { items: [{ product_id: id.product, quantity: 2, modifier_option_ids: [], note: 'less ice' }] }],
    ['note', { items: [{ product_id: id.product, quantity: 2, modifier_option_ids: [id.option], note: 'no ice' }] }],
  ])('rejects an idempotent retry with a different %s', async (_field, override) => {
    const tx = makeTx(); tx.transactions.findFirst.mockResolvedValue(response()); const { service: s } = service(tx);
    await expect(s.create(user as any, input(override))).rejects.toMatchObject({ response: { error_code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' } });
    expect(tx.product_stocks.updateMany).not.toHaveBeenCalled();
    expect(tx.transaction_items.create).not.toHaveBeenCalled();
    expect(tx.transaction_item_modifiers.createMany).not.toHaveBeenCalled();
  });
  it('retries transient duplicate-request conflicts and eventually reports retry required', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test', meta: { target: 'uq_transactions_client_id' } });
    const tx = makeTx(); const prisma: any = { $transaction: jest.fn().mockRejectedValue(error) }; const s = new TransactionsService(prisma);
    await expect(s.create(user as any, input())).rejects.toBeInstanceOf(ServiceUnavailableException); expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});
