import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import { ReceiptsService } from './receipts.service';

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  tenant: '22222222-2222-4222-8222-222222222222',
  outlet: '33333333-3333-4333-8333-333333333333',
  transaction: '44444444-4444-4444-8444-444444444444',
};
const user = { sub: ids.user, tenant_id: ids.tenant, role: 'CASHIER', outlet_id: ids.outlet };

function record(payment: Record<string, unknown>) {
  return {
    id: ids.transaction,
    client_transaction_id: '55555555-5555-4555-8555-555555555555',
    status: 'COMPLETED',
    subtotal: 20_000n,
    discount: 0n,
    tax: 0n,
    total: 20_000n,
    created_at: new Date('2026-01-01T00:00:00Z'),
    tenants: { id: ids.tenant, name: 'Tenant', address: null },
    outlets: { id: ids.outlet, name: 'Outlet', address: null },
    users: { id: ids.user, name: 'Cashier' },
    customers: null,
    transaction_items: [],
    payments: [{
      id: 'payment-1',
      method: 'CASH',
      status: 'PAID',
      amount: 20_000n,
      amount_received: 50_000n,
      change_amount: 30_000n,
      provider: null,
      provider_reference: null,
      paid_at: new Date('2026-01-01T00:00:00Z'),
      ...payment,
    }],
  };
}

async function receipt(payment: Record<string, unknown>) {
  const tx: any = {
    users: { findFirst: jest.fn<any>().mockResolvedValue({ role: 'CASHIER', outlet_id: ids.outlet }) },
    transactions: { findFirst: jest.fn<any>().mockResolvedValue(record(payment)) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return new ReceiptsService(prisma).findOne(user as any, ids.transaction);
}

describe('ReceiptsService M5 payment compatibility', () => {
  it('exposes settled amount, tender, and persisted change for V1 CASH', async () => {
    const result = await receipt({});
    expect(result.change).toBe(30_000);
    expect(result.payment).toEqual(expect.objectContaining({ method: 'CASH', amount: 20_000, amount_received: 50_000, change_amount: 30_000 }));
  });

  it('uses the pre-M5 amount-minus-total fallback for a historical RC2 CASH payment', async () => {
    const result = await receipt({ amount: 50_000n, amount_received: null, change_amount: null });
    expect(result.change).toBe(30_000);
  });

  it('preserves null change for QRIS', async () => {
    const result = await receipt({ method: 'QRIS', amount: 20_000n, amount_received: null, change_amount: null });
    expect(result.change).toBeNull();
    expect(result.payment).toEqual(expect.objectContaining({ method: 'QRIS', amount_received: null, change_amount: null }));
  });

  it('preserves record-only EDC with null change', async () => {
    const result = await receipt({ method: 'EDC', amount: 20_000n, amount_received: null, change_amount: null });
    expect(result.change).toBeNull();
    expect(result.payment).toEqual(expect.objectContaining({ method: 'EDC', amount_received: null, change_amount: null }));
  });

  it('loads legacy product fallback in one tenant-scoped lookup and preserves historical unit price', async () => {
    const transaction = record({});
    transaction.transaction_items = [{
      id: 'legacy-item', product_id: 'product-1', quantity: 2, unit_price: 12_000n, subtotal: 24_000n,
      product_name_snapshot: null, sku_snapshot: null, base_price_snapshot: null,
      effective_price_snapshot: null, note_snapshot: null,
      transaction_item_modifiers: [],
    }] as any;
    const products = { findMany: jest.fn<any>().mockResolvedValue([{ id: 'product-1', name: 'Legacy product', sku: 'LEGACY', price: 99_000 }]) };
    const tx: any = {
      users: { findFirst: jest.fn<any>().mockResolvedValue({ role: 'CASHIER', outlet_id: ids.outlet }) },
      transactions: { findFirst: jest.fn<any>().mockResolvedValue(transaction) },
      products,
    };
    const result = await new ReceiptsService({ $transaction: jest.fn(async (fn: any) => fn(tx)) } as any)
      .findOne(user as any, ids.transaction);
    expect(products.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenant_id: ids.tenant, id: { in: ['product-1'] } },
    }));
    expect(result.items[0]).toEqual(expect.objectContaining({
      product_name: 'Legacy product', sku: 'LEGACY', base_price: 12_000,
      effective_price: 12_000, unit_price: 12_000,
    }));
  });

  it('renders immutable item and modifier snapshots instead of current product data', async () => {
    const transaction = record({});
    transaction.transaction_items = [{
      id: 'item-1', product_id: 'product-1', quantity: 2, unit_price: 25_000n, subtotal: 50_000n,
      product_name_snapshot: 'Americano at sale', sku_snapshot: 'OLD-SKU', base_price_snapshot: 20_000n,
      effective_price_snapshot: 25_000n, note_snapshot: 'Less ice',
      products: { name: 'Renamed product', sku: 'NEW-SKU' },
      transaction_item_modifiers: [{
        id: 'modifier-1', modifier_group_id: 'group-1', modifier_option_id: 'option-1',
        group_name_snapshot: 'Extra', option_name_snapshot: 'Extra shot', price_delta_snapshot: 5_000,
      }],
    }] as any;
    const tx: any = {
      users: { findFirst: jest.fn<any>().mockResolvedValue({ role: 'CASHIER', outlet_id: ids.outlet }) },
      transactions: { findFirst: jest.fn<any>().mockResolvedValue(transaction) },
    };
    const result = await new ReceiptsService({ $transaction: jest.fn(async (fn: any) => fn(tx)) } as any)
      .findOne(user as any, ids.transaction);
    expect(result.items[0]).toEqual(expect.objectContaining({
      product_name: 'Americano at sale', sku: 'OLD-SKU', base_price: 20_000,
      effective_price: 25_000, note: 'Less ice',
    }));
    expect(result.items[0].modifiers).toEqual([expect.objectContaining({
      group_name: 'Extra', option_name: 'Extra shot', price_delta: 5_000,
    })]);
    expect(result.items[0].subtotal).toBe(50_000);
  });
});
