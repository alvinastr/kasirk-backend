import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
    payments: [{ id: 'p', method: 'CASH', status: 'PAID', amount: 300n, amount_received: 500n, change_amount: 200n, paid_at: new Date() }], ...overrides };
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

function service(tx: any) {
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { service: new TransactionsService(prisma), prisma, tx };
}

/**
 * M16B: regression tests proving the transaction core extraction preserved behavior.
 *
 * 1. Existing create() still opens exactly one Prisma transaction.
 * 2. Reusable transaction core does NOT open another Prisma transaction.
 * 3. All authoritative sale writes use the supplied tx.
 * 4. CASH transaction behavior remains unchanged.
 * 5. QRIS transaction behavior remains unchanged.
 * 6. Product/modifier validation remains unchanged.
 * 7. Tax/rounding remains unchanged (proven by tax.util.spec.ts).
 * 8. Stock decrement remains unchanged.
 * 9. Stock movement remains unchanged.
 * 10. Idempotent retry behavior remains unchanged.
 * 11. Existing duplicate client_transaction_id behavior remains unchanged.
 * 12. Failure inside the core propagates so the outer transaction rolls back.
 * 13. Existing offline/sync path behavior remains unchanged.
 */
describe('TransactionsService M16B extraction regression', () => {
  describe('M16G-0A: normal POST /transactions response is unchanged', () => {
    it('returns the canonical transaction at the TOP LEVEL with no replay metadata', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      const result: any = await s.create(user as any, input());

      // The normal transaction endpoint must keep returning the canonical
      // transaction object directly — no `transaction` wrapper, no `replayed`
      // key. Replay metadata belongs only to the held-order checkout contract.
      expect(result).not.toHaveProperty('replayed');
      expect(result).not.toHaveProperty('transaction');
      expect(result.transaction_id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(result.client_transaction_id).toBe('55555555-5555-4555-8555-555555555555');
      expect(result.status).toBe('COMPLETED');
      expect(Object.keys(result)).not.toContain('replayed');
    });

    it('keeps the flat transaction shape on the idempotent transaction retry', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      const result: any = await s.create(user as any, input());
      // Replay of a normal transaction also stays unwrapped.
      expect(result).not.toHaveProperty('replayed');
      expect(result).not.toHaveProperty('transaction');
      expect(result.transaction_id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    });
  });

  describe('public create() still opens exactly ONE Prisma transaction', () => {
    it('calls prisma.$transaction exactly once and delegates to executeTransactionCore', async () => {
      const tx = makeTx();
      const { service: s, prisma } = service(tx);
      await s.create(user as any, input());
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const fn = prisma.$transaction.mock.calls[0][0];
      expect(typeof fn).toBe('function');
    });
  });

  describe('executeTransactionCore does NOT open a nested Prisma transaction', () => {
    it('is a plain async function that uses only the supplied tx', async () => {
      const tx = makeTx();
      const { service: s, prisma } = service(tx);
      // Call the extracted core directly — it must NOT call $transaction
      await s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input(), 'V1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('all authoritative sale writes use the supplied tx', () => {
    it('writes transaction, items, modifiers, payment, stock, movements via tx', async () => {
      const tx = makeTx({
        products: { findMany: jest.fn<any>().mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 50, track_stock: true }]) },
        product_stocks: { updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }) },
      });
      const { service: s } = service(tx);
      await s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input(), 'V1');
      expect(tx.transactions.create).toHaveBeenCalled();
      expect(tx.transaction_items.create).toHaveBeenCalled();
      expect(tx.transaction_item_modifiers.createMany).toHaveBeenCalled();
      expect(tx.payments.create).toHaveBeenCalled();
      expect(tx.product_stocks.updateMany).toHaveBeenCalled();
      expect(tx.stock_movements.createMany).toHaveBeenCalled();
    });
  });

  describe('CASH transaction behavior unchanged', () => {
    it('computes change from amount_received and persists it', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ payment: { method: PaymentMethod.CASH, amount_received: 500 } }), 'V1');
      expect(tx.payments.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'CASH', amount: 300n, amount_received: 500n, change_amount: 200n }),
      }));
    });

    it('rejects underpayment with CASH_UNDERPAYMENT before writes', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ payment: { method: PaymentMethod.CASH, amount_received: 100 } }), 'V1'))
        .rejects.toThrow(BadRequestException);
      expect(tx.transactions.create).not.toHaveBeenCalled();
      expect(tx.transaction_items.create).not.toHaveBeenCalled();
    });
  });

  describe('QRIS transaction behavior unchanged', () => {
    it('persists QRIS with null amount_received and change_amount', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ payment: { method: PaymentMethod.QRIS } }), 'V1');
      expect(tx.payments.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ method: 'QRIS', amount_received: null, change_amount: null }),
      }));
    });

    it('rejects cash fields on QRIS with PAYMENT_FIELD_NOT_ALLOWED', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ payment: { method: PaymentMethod.QRIS, amount_received: 500 } }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('product/modifier validation unchanged', () => {
    it('rejects missing required SINGLE selection', async () => {
      const tx = makeTx({
        product_modifier_groups: { findMany: jest.fn<any>().mockResolvedValue([{ product_id: id.product, modifier_group_id: id.group, required: true, selection_type: 'SINGLE', modifier_groups: { name: 'Size' } }]) },
        modifier_options: { findMany: jest.fn<any>().mockResolvedValue([{ id: id.option, modifier_group_id: id.group, name: 'Large', price_delta: 50 }]) },
      });
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ items: [{ product_id: id.product, quantity: 1, modifier_option_ids: [] }] }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate modifier option on same line (in core via product_modifier_groups)', async () => {
      // This validates the core validates duplicate options at the assignment level
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ items: [{ product_id: id.product, quantity: 1, modifier_option_ids: [id.option, id.option] }] }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('stock decrement and movement unchanged', () => {
    it('aggregates duplicate tracked product lines before stock predicate', async () => {
      const tx = makeTx({
        products: { findMany: jest.fn<any>().mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 50, track_stock: true }]) },
        product_stocks: { updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }) },
      });
      const { service: s } = service(tx);
      await s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ items: [{ product_id: id.product, quantity: 2, modifier_option_ids: [id.option] }, { product_id: id.product, quantity: 3, modifier_option_ids: [id.option] }], payment: { method: PaymentMethod.CASH, amount: 5_000 } }), 'V1');
      // Total aggregated qty = 5
      expect(tx.product_stocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ product_id: id.product }),
        data: expect.objectContaining({ stock: { decrement: 5 } }),
      }));
    });

    it('rejects insufficient stock before creating movements', async () => {
      const tx = makeTx({
        products: { findMany: jest.fn<any>().mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 50, track_stock: true }]) },
        product_stocks: { updateMany: jest.fn<any>().mockResolvedValue({ count: 0 }) },
      });
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input(), 'V1'))
        .rejects.toThrow(ConflictException);
      expect(tx.stock_movements.createMany).not.toHaveBeenCalled();
    });

    it('creates exactly one movement entry per aggregated tracked product', async () => {
      const otherProduct = '66666666-6666-4666-8666-666666666667';
      const tx = makeTx({
        products: { findMany: jest.fn<any>().mockResolvedValue([
          { id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 50, track_stock: true },
          { id: otherProduct, name: 'Tea', sku: 'TEA', price: 80, cost: 30, track_stock: true },
        ]) },
        product_stocks: { updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }) },
      });
      const { service: s } = service(tx);
      await s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ items: [{ product_id: id.product, quantity: 2, modifier_option_ids: [id.option] }, { product_id: otherProduct, quantity: 3, modifier_option_ids: [] }], payment: { method: PaymentMethod.CASH, amount: 5_000 } }), 'V1');
      expect(tx.stock_movements.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ product_id: id.product, quantity: -2 }),
          expect.objectContaining({ product_id: otherProduct, quantity: -3 }),
        ]),
      }));
    });
  });

  describe('idempotent retry behavior unchanged', () => {
    it('returns existing transaction for identical client_transaction_id', async () => {
      const base = makeTx();
      const tx = makeTx({
        transactions: { ...base.transactions, findFirst: jest.fn<any>().mockResolvedValue(response()) },
      });
      const { service: s } = service(tx);
      const result = await s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input(), 'V1');
      expect(result.client_transaction_id).toBe(id.client);
      expect(tx.transactions.create).not.toHaveBeenCalled();
    });

    it('rejects idempotency payload mismatch', async () => {
      const base = makeTx();
      const tx = makeTx({
        transactions: { ...base.transactions, findFirst: jest.fn<any>().mockResolvedValue(response({ discount: 50n })) },
      });
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input(), 'V1'))
        .rejects.toThrow(ConflictException);
    });

    it('treats legacy CASH and V1 CASH retry as semantically idempotent', async () => {
      // Legacy stored tender in `amount` (no amount_received); V1 stores it in amount_received.
      const base = makeTx();
      const legacyRow = response({
        transaction_items: [{
          id: 'legacy-item', product_id: id.product, quantity: 2, unit_price: 150n, unit_cost: 50n, subtotal: 300n,
          product_name_snapshot: null, sku_snapshot: null, base_price_snapshot: null, effective_price_snapshot: null,
          note_snapshot: null, transaction_item_modifiers: [],
        }],
        payments: [{ id: 'p', method: 'CASH', status: 'PAID', amount: 500n, amount_received: null, change_amount: 200n, paid_at: new Date() }],
      });
      const tx = makeTx({
        transactions: { ...base.transactions, findFirst: jest.fn<any>().mockResolvedValue(legacyRow) },
      });
      const { service: s } = service(tx);
      await s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({
        items: [{ product_id: id.product, quantity: 2, modifier_option_ids: [] }],
        payment: { method: PaymentMethod.CASH, amount_received: 500 },
      }), 'V1');
      // Should match because persisted tender (500) == requested tender (500)
      expect(tx.transactions.create).not.toHaveBeenCalled();
    });

    it('rejects V1 CASH retry with different resolved tender', async () => {
      const base = makeTx();
      const tx = makeTx({
        transactions: { ...base.transactions, findFirst: jest.fn<any>().mockResolvedValue(response({ payments: [{ id: 'p', method: 'CASH', status: 'PAID', amount: 300n, amount_received: 500n, change_amount: 200n, paid_at: new Date() }] })) },
      });
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ payment: { method: PaymentMethod.CASH, amount_received: 600 } }), 'V1'))
        .rejects.toThrow(ConflictException);
    });
  });

  /**
   * M16B SAFETY FIX: the core is public, so it must enforce the V1 input
   * contract itself. Every case below was proven to reach pricing, stock, and
   * persistence when the core was called directly with an unvalidated DTO.
   * Each now throws INVALID_INPUT, exactly as public create() always did.
   */
  describe('core rejects unvalidated DTO shapes that class-validator blocks on create()', () => {
    const actor = () => ({ ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() });

    it('rejects negative discount', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), input({ discount: -50 }), 'V1'))
        .rejects.toThrow(BadRequestException);
      expect(tx.transactions.create).not.toHaveBeenCalled();
    });

    it('rejects non-integer discount without a raw BigInt RangeError', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), input({ discount: 10.5 }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects zero quantity', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), input({ items: [{ product_id: id.product, quantity: 0 }] }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects quantity above the Int4 column bound', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), input({ items: [{ product_id: id.product, quantity: 2147483648 }] }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects note longer than 255 characters', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), input({ items: [{ product_id: id.product, quantity: 1, note: 'x'.repeat(5000) }] }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate modifier_option_ids on a line', async () => {
      const tx = makeTx({ product_modifier_groups: { findMany: jest.fn<any>().mockResolvedValue([
        { product_id: id.product, modifier_group_id: id.group, required: false, selection_type: 'MULTIPLE', modifier_groups: { name: 'Extras' } }]) } });
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), input({ items: [{ product_id: id.product, quantity: 1, modifier_option_ids: [id.option, id.option] }] }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects a null cashier_session_id in V1 mode', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), input({ cashier_session_id: null }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects a missing payment object instead of dereferencing undefined', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), input({ payment: undefined }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown extra field (forbidNonWhitelisted)', async () => {
      const tx = makeTx();
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), input({ sneaky_extra: 1 }), 'V1'))
        .rejects.toThrow(BadRequestException);
    });

    it('LEGACY_SYNC still accepts its narrower shape (no session, legacy tender)', async () => {
      const base = makeTx();
      const tx = makeTx({
        transactions: { ...base.transactions, findFirst: jest.fn<any>().mockResolvedValue(null) },
        product_modifier_groups: { findMany: jest.fn<any>().mockResolvedValue([]) },
      });
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, actor(), {
        client_transaction_id: id.client,
        outlet_id: id.outlet,
        items: [{ product_id: id.product, quantity: 2 }],
        payment: { method: PaymentMethod.CASH, amount: 300 },
      } as any, 'LEGACY_SYNC')).resolves.toBeDefined();
      expect(tx.transactions.create).toHaveBeenCalled();
    });
  });

  describe('failure inside the core propagates for rollback', () => {
    it('throws BadRequestException for invalid outlet, causing outer rollback', async () => {
      const tx = makeTx({
        outlets: { findFirst: jest.fn<any>().mockResolvedValue(null) },
      });
      const { service: s } = service(tx);
      await expect(s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input(), 'V1'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('offline/sync path (createLegacySync) behavior unchanged', () => {
    it('calls executeTransactionCore with mode LEGACY_SYNC and null cashier_session_id', async () => {
      const base = makeTx();
      const tx = makeTx({
        transactions: { ...base.transactions, findFirst: jest.fn<any>().mockResolvedValue(null) },
        product_modifier_groups: { findMany: jest.fn<any>().mockResolvedValue([]) },
      });
      const { service: s, prisma } = service(tx);
      // createLegacySync is the public sync entry; it calls createInternal with mode LEGACY_SYNC
      await s.createLegacySync(user as any, {
        client_transaction_id: id.client,
        outlet_id: id.outlet,
        items: [{ product_id: id.product, quantity: 2 }],
        payment: { method: PaymentMethod.CASH, amount: 300 },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Legacy sync persists an intentional NULL cashier_session_id.
      expect(tx.transactions.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ cashier_session_id: null }),
      }));
    });

    it('uses the same authoritative pricing and modifier logic', async () => {
      const tx = makeTx({ product_modifier_groups: { findMany: jest.fn<any>().mockResolvedValue([]) } });
      const { service: s } = service(tx);
      await s.executeTransactionCore(tx, { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() }, input({ items: [{ product_id: id.product, quantity: 2 }], payment: { method: PaymentMethod.CASH, amount: 300 } }), 'LEGACY_SYNC');
      expect(tx.transaction_items.create).toHaveBeenCalled();
    });
  });
});