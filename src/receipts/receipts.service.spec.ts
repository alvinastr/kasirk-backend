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
  it('uses persisted change for a new M5 CASH payment without expanding payment shape', async () => {
    const result = await receipt({});
    expect(result.change).toBe(30_000);
    expect(result.payment).toEqual(expect.objectContaining({ amount: 20_000 }));
    expect(result.payment).not.toHaveProperty('amount_received');
    expect(result.payment).not.toHaveProperty('change_amount');
  });

  it('uses the pre-M5 amount-minus-total fallback for a historical RC2 CASH payment', async () => {
    const result = await receipt({ amount: 50_000n, amount_received: null, change_amount: null });
    expect(result.change).toBe(30_000);
  });

  it('preserves null change for QRIS', async () => {
    const result = await receipt({ method: 'QRIS', amount: 20_000n, amount_received: null, change_amount: null });
    expect(result.change).toBeNull();
    expect(result.payment).not.toHaveProperty('amount_received');
    expect(result.payment).not.toHaveProperty('change_amount');
  });
});
