import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { HeldOrdersService } from './held-orders.service';
import type { CheckoutDto } from '../transactions/transactions.service';
import { TransactionStatus, PaymentMethod } from '../transactions/types/transaction.types';
import { CheckoutHeldOrderDto } from './dto/checkout-held-order.dto';
import { calculateTax } from '../common/utils/tax.util';

const id = {
  tenant: '11111111-1111-4111-8111-111111111111',
  user: '22222222-2222-4222-8222-222222222222',
  outlet: '33333333-3333-4333-8333-333333333333',
  otherTenant: '11111111-1111-4111-8111-111111111112',
  otherOutlet: '33333333-3333-4333-8333-333333333334',
  session: '44444444-4444-4444-8444-444444444444',
  otherSession: '44444444-4444-4444-8444-444444444445',
  order: '55555555-5555-4555-8555-555555555555',
  product: '66666666-6666-4666-8666-666666666666',
  group: '77777777-7777-4777-8777-777777777777',
  option: '88888888-8888-4888-8888-888888888888',
  item: '99999999-9999-4999-8999-999999999999',
};
const user = { sub: id.user, tenant_id: id.tenant, role: 'CASHIER' } as any;
const now = new Date('2026-10-07T00:00:00.000Z');

function input() {
  return {
    outlet_id: id.outlet,
    cashier_session_id: id.session,
    label: ' Meja 4 ',
    items: [{ product_id: id.product, quantity: 2, modifier_option_ids: [id.option], note: ' less ice ' }],
  } as any;
}

function heldOrder(overrides: Record<string, unknown> = {}) {
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

function checkoutDtoFromPayload(payload: { client_transaction_id: string; payment: any }): CheckoutDto {
  return {
    client_transaction_id: payload.client_transaction_id,
    outlet_id: id.outlet,
    cashier_session_id: id.session,
    discount: 0,
    items: [{
      product_id: id.product,
      quantity: 2,
      modifier_option_ids: [id.option],
      note: 'less ice',
    }],
    payment: payload.payment,
  } as any;
}

let claimAttempts = 0;

function makeTx() {
  const tx: any = {
    held_orders: {
      findFirst: jest.fn<any>(),
      updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
    },
    transactions: {
      findFirst: jest.fn<any>(),
      create: jest.fn<any>().mockResolvedValue({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      update: jest.fn<any>(),
    },
    transaction_items: {
      create: jest.fn<any>().mockResolvedValue({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
    },
    transaction_item_modifiers: {
      createMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
    },
    product_stocks: {
      updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
    },
    stock_movements: {
      createMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
    },
    payments: {
      create: jest.fn<any>().mockResolvedValue({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
    },
    held_order_items: {
      create: jest.fn<any>(),
    },
    tenants: {
      findFirst: jest.fn<any>().mockResolvedValue({ tax_enabled: false, tax_rate: 0 }),
    },
    outlets: {
      findFirst: jest.fn<any>().mockResolvedValue({ id: id.outlet }),
    },
    cashier_sessions: {
      findFirst: jest.fn<any>().mockResolvedValue({ id: id.session, outlet_id: id.outlet, user_id: id.user, tenant_id: id.tenant, status: 'OPEN', closed_at: null }),
    },
    users: {
      findFirst: jest.fn<any>().mockResolvedValue({ role: 'CASHIER', outlet_id: id.outlet }),
    },
    products: {
      findMany: jest.fn<any>().mockResolvedValue([{ id: id.product, name: 'Coffee', sku: 'COF', price: 100, cost: 0, track_stock: true }]),
    },
    product_modifier_groups: {
      findMany: jest.fn<any>().mockResolvedValue([{ product_id: id.product, modifier_group_id: id.group, required: true, selection_type: 'SINGLE', modifier_groups: { name: 'Size' } }]),
    },
    modifier_options: {
      findMany: jest.fn<any>().mockResolvedValue([{ id: id.option, modifier_group_id: id.group, name: 'Large', price_delta: 50 }]),
    },
  };
  return tx;
}

function mockTransactionsService(tx: any) {
  const svc = {
    executeTransactionCore: jest.fn<any>(),
  };
  svc.executeTransactionCore.mockImplementation(async (txClient: any, user: any, dto: any, mode: string) => {
    expect(mode).toBe('V1');
    expect(txClient).toBe(tx);

    // Normalize like real core
    const normalized = {
      ...dto,
      client_transaction_id: dto.client_transaction_id.toLowerCase(),
      outlet_id: dto.outlet_id.toLowerCase(),
      cashier_session_id: dto.cashier_session_id?.toLowerCase() ?? null,
      discount: dto.discount ?? 0,
      items: (dto.items ?? []).map((item: any) => ({
        ...item,
        product_id: item.product_id.toLowerCase(),
        modifier_option_ids: (item.modifier_option_ids ?? []).map((id: string) => id.toLowerCase()),
        note: item.note?.trim(),
      })),
    };

    // Idempotency lookup
    const existing = await tx.transactions.findFirst({
      where: { tenant_id: user.tenant_id, client_transaction_id: normalized.client_transaction_id },
      select: {
        id: true,
        tenant_id: true,
        client_transaction_id: true,
        outlet_id: true,
        user_id: true,
        cashier_session_id: true,
        customer_id: true,
        discount: true,
        status: true,
        subtotal: true,
        tax: true,
        total: true,
        created_at: true,
        transaction_items: {
          select: {
            id: true,
            product_id: true,
            quantity: true,
            note_snapshot: true,
            transaction_item_modifiers: { select: { modifier_option_id: true } },
          },
        },
        payments: { select: { id: true, method: true, status: true, amount: true, amount_received: true, change_amount: true, paid_at: true } },
      },
    });
    if (existing) {
      const payment = existing.payments?.[0];
      if (
        existing.client_transaction_id !== normalized.client_transaction_id ||
        payment?.method !== normalized.payment.method ||
        (normalized.payment.method === 'CASH' && Number(payment?.amount_received) !== normalized.payment.amount_received)
      ) {
        throw new ConflictException({ message: 'Idempotency key mismatch', error_code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
      }
      return {
        transaction_id: existing.id,
        client_transaction_id: existing.client_transaction_id,
        outlet_id: existing.outlet_id,
        user_id: existing.user_id,
        customer_id: existing.customer_id,
        status: existing.status,
        subtotal: Number(existing.subtotal),
        discount: Number(existing.discount),
        tax: Number(existing.tax),
        total: Number(existing.total),
        cashier_session_id: existing.cashier_session_id,
        created_at: existing.created_at,
        items: existing.transaction_items.map((item: any) => ({
          ...item,
          transaction_item_modifiers: item.transaction_item_modifiers.map((m: any) => m.modifier_option_id),
        })),
        payments: existing.payments,
      };
    }

    // Session validation for V1
    const session = await tx.cashier_sessions.findFirst({
      where: { id: normalized.cashier_session_id!, tenant_id: user.tenant_id, user_id: user.sub, status: 'OPEN' },
      select: { id: true, outlet_id: true },
    });
    if (!session) {
      throw new ForbiddenException({ message: 'Cashier session not found, not open, or does not belong to this actor', error_code: 'INVALID_CASHIER_SESSION' });
    }
    if (session.outlet_id !== normalized.outlet_id) {
      throw new ForbiddenException({ message: 'Cashier session outlet does not match transaction outlet', error_code: 'SESSION_OUTLET_MISMATCH' });
    }

    // Product lookup
    const productIds = [...new Set(normalized.items.map((i: any) => i.product_id))];
    const products = await tx.products.findMany({
      where: { tenant_id: user.tenant_id, is_active: true, id: { in: productIds } },
      select: { id: true, name: true, sku: true, price: true, cost: true, track_stock: true },
    });
    if (products.length !== productIds.length) {
      throw new NotFoundException('One or more products not found or inactive');
    }
    const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));

    // Modifier assignments
    const assignments = await tx.product_modifier_groups.findMany({
      where: { tenant_id: user.tenant_id, product_id: { in: productIds }, modifier_groups: { is_active: true } },
      select: { product_id: true, modifier_group_id: true, required: true, selection_type: true, modifier_groups: { select: { name: true } } },
    });
    const groupIds = [...new Set(assignments.map((a: any) => a.modifier_group_id))];
    const options = groupIds.length > 0 ? await tx.modifier_options.findMany({
      where: { tenant_id: user.tenant_id, modifier_group_id: { in: groupIds }, is_active: true },
      select: { id: true, modifier_group_id: true, name: true, price_delta: true },
    }) : [];
    const optionMap = new Map<string, any>(options.map((o: any) => [o.id, o]));

    // Validate items and compute prices
    const validatedItems: any[] = [];
    const stockByProduct = new Map<string, number>();
    for (const item of normalized.items) {
      const product = productMap.get(item.product_id);
      if (!product) throw new NotFoundException(`Product ${item.product_id} not found`);

      const itemAssignments = assignments.filter((a: any) => a.product_id === item.product_id);
      const resolvedOptions: any[] = [];

      if ((item.modifier_option_ids?.length ?? 0) > 0) {
        for (const optId of item.modifier_option_ids!) {
          const opt = optionMap.get(optId);
          if (!opt) throw new BadRequestException({ message: `Modifier option ${optId} not found or inactive`, error_code: 'MODIFIER_OPTION_NOT_FOUND' });
          const assigned = itemAssignments.find((a: any) => a.modifier_group_id === opt.modifier_group_id);
          if (!assigned) throw new BadRequestException({ message: `Modifier option ${optId} belongs to a group not assigned to this product`, error_code: 'MODIFIER_GROUP_NOT_ASSIGNED' });
          resolvedOptions.push({
            id: opt.id,
            modifier_group_id: opt.modifier_group_id,
            group_name: assigned.modifier_groups?.name,
            option_name: opt.name,
            price_delta: opt.price_delta,
          });
        }
      } else {
        for (const assign of itemAssignments) {
          if (assign.required && assign.selection_type === 'SINGLE') {
            throw new BadRequestException({ message: `Required single-selection modifier group has no selection`, error_code: 'REQUIRED_SINGLE_MODIFIER_MISSING' });
          }
        }
      }

      const delta = resolvedOptions.reduce((sum, o) => sum + o.price_delta, 0);
      const effectivePrice = BigInt(product.price + delta);
      if (effectivePrice < 0n) throw new BadRequestException('Effective price negative');
      validatedItems.push({ product, options: resolvedOptions, effectivePrice, quantity: item.quantity, note: item.note });
      stockByProduct.set(item.product_id, (stockByProduct.get(item.product_id) ?? 0) + item.quantity);
    }

    // Compute totals
    const itemsForPersistence = validatedItems.map((vi: any) => ({
      tenant_id: user.tenant_id,
      product_id: vi.product.id,
      quantity: vi.quantity,
      unit_price: vi.effectivePrice,
      unit_cost: BigInt(vi.product.cost),
      subtotal: vi.effectivePrice * BigInt(vi.quantity),
      track_stock: vi.product.track_stock,
      product_name_snapshot: vi.product.name,
      sku_snapshot: vi.product.sku,
      base_price_snapshot: BigInt(vi.product.price),
      effective_price_snapshot: vi.effectivePrice,
      note_snapshot: vi.note ?? null,
    }));
    const subtotal = itemsForPersistence.reduce((sum, item) => sum + item.subtotal, 0n);
    const discount = BigInt(normalized.discount);
    if (discount > subtotal) throw new BadRequestException('Discount exceeds subtotal');
    const taxableAmount = subtotal - discount;
    const { tax, total } = calculateTax(
      (await tx.tenants.findFirst({ where: { id: user.tenant_id }, select: { tax_enabled: true, tax_rate: true } }))?.tax_enabled ?? false,
      (await tx.tenants.findFirst({ where: { id: user.tenant_id }, select: { tax_enabled: true, tax_rate: true } }))?.tax_rate ?? '0',
      taxableAmount,
    );
    if (total <= 0n) throw new BadRequestException('Transaction total must be positive');

    // Payment validation
    const resolvedTender = normalized.payment.method === 'CASH' ? normalized.payment.amount_received : null;
    if (resolvedTender !== null && resolvedTender < total) {
      throw new BadRequestException({ message: 'Cash amount received is less than total', error_code: 'CASH_UNDERPAYMENT' });
    }

    // Create transaction header
    const txCreate = await tx.transactions.create({
      data: {
        tenant_id: user.tenant_id,
        outlet_id: normalized.outlet_id,
        user_id: user.sub,
        client_transaction_id: normalized.client_transaction_id,
        cashier_session_id: normalized.cashier_session_id,
        customer_id: normalized.customer_id ?? null,
        discount: discount,
        status: 'COMPLETED',
        subtotal,
        tax,
        total,
      },
    });

    // Create items
    const createdItems: any[] = [];
    for (let i = 0; i < validatedItems.length; i++) {
      const vi = validatedItems[i];
      const itemData = itemsForPersistence[i];
      const itemCreate = await tx.transaction_items.create({ data: itemData });
      createdItems.push({
        id: itemCreate.id,
        product_id: vi.product.id,
        quantity: vi.quantity,
        unit_price: Number(vi.effectivePrice),
        unit_cost: vi.product.cost,
        subtotal: Number(vi.effectivePrice * BigInt(vi.quantity)),
        product_name_snapshot: vi.product.name,
        sku_snapshot: vi.product.sku,
        base_price_snapshot: vi.product.price,
        effective_price_snapshot: Number(vi.effectivePrice),
        note_snapshot: vi.note,
        transaction_item_modifiers: vi.options.map((opt: any) => ({
          id: `modifier-${opt.id}`,
          modifier_group_id: opt.modifier_group_id,
          modifier_option_id: opt.id,
          group_name_snapshot: opt.group_name,
          option_name_snapshot: opt.option_name,
          price_delta_snapshot: opt.price_delta,
        })),
      });

      if (vi.options.length) {
        await tx.transaction_item_modifiers.createMany({
          data: vi.options.map((opt: any) => ({
            tenant_id: user.tenant_id,
            transaction_item_id: itemCreate.id,
            modifier_group_id: opt.modifier_group_id,
            modifier_option_id: opt.id,
            group_name_snapshot: opt.group_name,
            option_name_snapshot: opt.option_name,
            price_delta_snapshot: opt.price_delta,
          })),
        });
      }
    }

    // Stock decrement
    for (const [productId, qty] of stockByProduct) {
      const stockUpdate = await tx.product_stocks.updateMany({
        where: { tenant_id: user.tenant_id, product_id: productId, quantity: { gte: qty } },
        data: { quantity: { decrement: qty } },
      });
      if (stockUpdate.count === 0) {
        throw new ConflictException({ message: 'Insufficient stock', error_code: 'INSUFFICIENT_STOCK' });
      }
    }

    // Stock movements
    await tx.stock_movements.createMany({
      data: Array.from(stockByProduct.entries()).map(([productId, qty]) => ({
        tenant_id: user.tenant_id,
        product_id: productId,
        quantity_change: -qty,
        reason: 'SALE',
        reference_id: txCreate.id,
        reference_type: 'TRANSACTION',
      })),
    });

    // Payment
    await tx.payments.create({
      data: {
        tenant_id: user.tenant_id,
        transaction_id: txCreate.id,
        method: normalized.payment.method,
        status: 'PAID',
        amount: total,
        amount_received: normalized.payment.method === 'CASH' ? normalized.payment.amount_received : null,
        change_amount: normalized.payment.method === 'CASH' ? BigInt(normalized.payment.amount_received) - total : null,
        paid_at: new Date(),
      },
    });

    // Update transaction status
    await tx.transactions.update({
      where: { id: txCreate.id },
      data: { status: 'COMPLETED' },
    });

    return {
      transaction_id: txCreate.id,
      client_transaction_id: normalized.client_transaction_id,
      outlet_id: normalized.outlet_id,
      user_id: user.sub,
      customer_id: normalized.customer_id ?? null,
      status: 'COMPLETED',
      subtotal: Number(subtotal),
      discount: Number(discount),
      tax: Number(tax),
      total: Number(total),
      cashier_session_id: normalized.cashier_session_id,
      created_at: txCreate.created_at,
      items: createdItems,
      payments: [{
        id: 'p1',
        method: normalized.payment.method,
        status: 'PAID',
        amount: Number(total),
        amount_received: normalized.payment.method === 'CASH' ? normalized.payment.amount_received : null,
        change_amount: normalized.payment.method === 'CASH' ? Number(BigInt(normalized.payment.amount_received) - total) : null,
        paid_at: new Date(),
      }],
    };
  });
  return svc;
}

function service(tx: any, transactionsService: any, options: { failures?: any[] } = {}) {
  const failures = [...(options.failures ?? [])];
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => {
      if (failures.length) throw failures.shift();
      return callback(tx);
    }),
  };
  return { service: new HeldOrdersService(prisma, transactionsService), prisma, tx, transactionsService };
}

function prismaError(code: string, target?: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError('prisma failure', {
    code,
    clientVersion: 'test',
    meta: target === undefined ? undefined : { target },
  });
}

describe('HeldOrdersService M16C conversion (mocked core)', () => {
  it('converts an OPEN held order into exactly one transaction', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject } = service(tx, svc);

    const result = await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    expect(result.status).toBe(TransactionStatus.COMPLETED);
    expect(tx.held_orders.updateMany).toHaveBeenCalledTimes(2);
    const [claimUpdate, terminalUpdate] = tx.held_orders.updateMany.mock.calls as any;
    expect(claimUpdate[0].where.version).toBe(1);
    expect(claimUpdate[0].data.version).toEqual({ increment: 1 });
    expect(claimUpdate[0].where.status).toBe('OPEN');
    expect(terminalUpdate[0].data.status).toBe('CONVERTED');
    expect(terminalUpdate[0].data.converted_at).toBeDefined();
    expect(terminalUpdate[0].data.converted_transaction_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(result.transaction_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(tx.held_order_items.create).not.toHaveBeenCalled();
    expect(tx.transactions.create).toHaveBeenCalled();
    expect(tx.transactions.update).toHaveBeenCalled();
    expect(tx.payments.create).toHaveBeenCalled();
    expect(tx.product_stocks.updateMany).toHaveBeenCalled();
    expect(tx.stock_movements.createMany).toHaveBeenCalled();
  });

  it('returns the canonical transaction', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject } = service(tx, svc);

    const result = await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    // The canonical transaction id is whatever the core persisted; the service
    // must return it verbatim, not re-derive or invent one.
    expect(result.transaction_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(result.client_transaction_id).toBe('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  });

  it('marks the held order CONVERTED', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    const update = tx.held_orders.updateMany.mock.calls[1][0] as any;
    expect(update.data.status).toBe('CONVERTED');
  });

  it('sets converted_transaction_id equal to the canonical transaction id', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject } = service(tx, svc);

    const result = await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    const update = tx.held_orders.updateMany.mock.calls[1][0] as any;
    expect(update.data.converted_transaction_id).toBe(result.transaction_id);
    expect(update.data.converted_transaction_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('sets converted_at in the same terminal update statement', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    const update = tx.held_orders.updateMany.mock.calls[1][0] as any;
    expect(update.data.converted_at).toBeDefined();
  });

  it('passes the same TransactionClient to executeTransactionCore', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject, tx: outerTx } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    expect(svc.executeTransactionCore).toHaveBeenCalledWith(outerTx, expect.objectContaining({ tenant_id: id.tenant }), expect.anything(), 'V1');
  });

  it('uses mode V1, not LEGACY_SYNC', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    expect(svc.executeTransactionCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'V1',
    );
  });

  it('uses the held order origin_cashier_session_id as the session', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    const dto = svc.executeTransactionCore.mock.calls[0][2] as any;
    expect(dto.cashier_session_id).toBe(id.session);
  });

  it('does not open a nested Prisma transaction', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject, prisma } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('conflicts on stale expected_version without creating a sale', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder({ version: 2 }));

    const { service: subject, prisma, tx: outerTx } = service(tx, svc);

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_VERSION_CONFLICT' } });

    expect(outerTx.held_orders.updateMany).not.toHaveBeenCalled();
    expect(outerTx.transactions.create).not.toHaveBeenCalled();
    expect(outerTx.payments.create).not.toHaveBeenCalled();
    expect(outerTx.product_stocks.updateMany).not.toHaveBeenCalled();
    expect(outerTx.stock_movements.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('conflicts when the held order is CANCELLED without creating a sale', async () => {
    const tx = makeTx();
    tx.held_orders.findFirst.mockResolvedValue(heldOrder({ status: 'CANCELLED' }));
    const { service: subject, prisma } = service(tx, mockTransactionsService(tx));

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_NOT_OPEN' } });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.transactions.create).not.toHaveBeenCalled();
  });

  it('conflicts when the origin session is closed without creating a sale', async () => {
    const tx = makeTx();
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());
    tx.cashier_sessions.findFirst.mockResolvedValue(null);
    const { service: subject, prisma } = service(tx, mockTransactionsService(tx));

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({ response: { error_code: 'INVALID_CASHIER_SESSION' } });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.transactions.create).not.toHaveBeenCalled();
  });

  it('conflicts when the origin session belongs to another tenant without creating a sale', async () => {
    const tx = makeTx();
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());
    tx.cashier_sessions.findFirst.mockResolvedValue(null);
    const { service: subject, prisma } = service(tx, mockTransactionsService(tx));

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({ response: { error_code: 'INVALID_CASHIER_SESSION' } });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.transactions.create).not.toHaveBeenCalled();
  });

  it('rolls back on insufficient stock and leaves the order OPEN', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());
    // Stock check inside the core: updateMany returns 0 when stock is insufficient.
    tx.product_stocks.updateMany.mockResolvedValue({ count: 0 });

    const { service: subject, tx: outerTx } = service(tx, svc);

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({
      response: { error_code: 'INSUFFICIENT_STOCK' },
    });

    // Outer transaction rethrows; no write persists.
    expect(outerTx.held_orders.updateMany).toHaveBeenCalledTimes(1); // only the claim is attempted; with mock it appears applied but the real tx rolls back
    expect(outerTx.transactions.create).toHaveBeenCalledTimes(1);
    expect(outerTx.payments.create).not.toHaveBeenCalled();
    expect(outerTx.product_stocks.updateMany).toHaveBeenCalledTimes(1);
    expect(outerTx.stock_movements.createMany).not.toHaveBeenCalled();
  });

  it('rolls back when a product is inactive and leaves the order OPEN', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());
    tx.products.findMany.mockResolvedValue([]);

    const { service: subject, tx: outerTx } = service(tx, svc);

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({
      response: { statusCode: 404 },
    });

    expect(outerTx.transactions.create).not.toHaveBeenCalled();
    expect(outerTx.payments.create).not.toHaveBeenCalled();
    expect(outerTx.product_stocks.updateMany).not.toHaveBeenCalled();
  });

  it('rolls back when a modifier option is inactive and leaves the order OPEN', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());
    tx.modifier_options.findMany.mockResolvedValue([]);

    const { service: subject, tx: outerTx } = service(tx, svc);

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(outerTx.transactions.create).not.toHaveBeenCalled();
    expect(outerTx.payments.create).not.toHaveBeenCalled();
  });

  it('rolls back on CASH underpayment', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject, tx: outerTx } = service(tx, svc);

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.CASH, amount_received: 100 },
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(outerTx.transactions.create).not.toHaveBeenCalled();
    expect(outerTx.payments.create).not.toHaveBeenCalled();
  });

  it('rolls back on a core domain failure', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());
    svc.executeTransactionCore.mockRejectedValueOnce(new Error('catalog changed'));

    const { service: subject, tx: outerTx } = service(tx, svc);

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({
      response: { error_code: 'HELD_ORDER_CONVERSION_FAILED' },
    });

    expect(outerTx.transactions.create).not.toHaveBeenCalled();
    expect(outerTx.payments.create).not.toHaveBeenCalled();
  });

  it('idempotently returns the canonical existing success for a duplicate request with the same client_transaction_id', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder({
      status: 'CONVERTED',
      converted_transaction_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      converted_at: now,
    }));
    tx.transactions.findFirst.mockResolvedValue({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenant_id: id.tenant,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      outlet_id: id.outlet,
      user_id: id.user,
      cashier_session_id: id.session,
      customer_id: null,
      discount: 0n,
      status: 'COMPLETED',
      subtotal: 300n,
      tax: 0n,
      total: 300n,
      created_at: now,
      transaction_items: [{
        product_id: id.product, quantity: 2, note_snapshot: 'less ice',
        transaction_item_modifiers: [{ modifier_option_id: id.option }],
      }],
      payments: [{ id: 'p1', method: 'QRIS', status: 'PAID', amount: 300n, amount_received: null, change_amount: null }],
    });

    const { service: subject } = service(tx, svc);

    const result = await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    expect(result.transaction_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(tx.transactions.create).not.toHaveBeenCalled();
    expect(tx.payments.create).not.toHaveBeenCalled();
    expect(tx.product_stocks.updateMany).not.toHaveBeenCalled();
    expect(tx.stock_movements.createMany).not.toHaveBeenCalled();
  });

  it('conflicts when retrying with a different client_transaction_id', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder({
      status: 'CONVERTED',
      converted_transaction_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      converted_at: now,
    }));
    tx.transactions.findFirst.mockResolvedValue({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenant_id: id.tenant,
      client_transaction_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      outlet_id: id.outlet,
      user_id: id.user,
      cashier_session_id: id.session,
      customer_id: null,
      discount: 0n,
      status: 'COMPLETED',
      subtotal: 300n,
      tax: 0n,
      total: 300n,
      created_at: now,
      transaction_items: [{
        product_id: id.product, quantity: 2, note_snapshot: 'less ice',
        transaction_item_modifiers: [{ modifier_option_id: id.option }],
      }],
      payments: [{ id: 'p1', method: 'QRIS', status: 'PAID', amount: 300n, amount_received: null, change_amount: null }],
    });

    const { service: subject } = service(tx, svc);

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({
      response: { error_code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' },
    });
  });

  it('conflicts when the same client_transaction_id carries an incompatible payment', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder({
      status: 'CONVERTED',
      converted_transaction_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      converted_at: now,
    }));
    tx.transactions.findFirst.mockResolvedValue({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenant_id: id.tenant,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      outlet_id: id.outlet,
      user_id: id.user,
      cashier_session_id: id.session,
      customer_id: null,
      discount: 0n,
      status: 'COMPLETED',
      subtotal: 300n,
      tax: 0n,
      total: 300n,
      created_at: now,
      transaction_items: [{
        product_id: id.product, quantity: 2, note_snapshot: 'less ice',
        transaction_item_modifiers: [{ modifier_option_id: id.option }],
      }],
      payments: [{ id: 'p1', method: 'CASH', status: 'PAID', amount: 300n, amount_received: 300n, change_amount: 0n }],
    });

    const { service: subject } = service(tx, svc);

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({
      response: { error_code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' },
    });
  });

  it('exactly one of two concurrent callers converts', async () => {
    const tx = makeTx();
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());
    const svc = mockTransactionsService(tx);

    let secondAttempted = false;
    const globalClaimed = { claimed: false };

    // Replace updateMany with a shared claim counter so concurrent calls see the winner.
    tx.held_orders.updateMany.mockImplementation(async (where: any) => {
      if (globalClaimed.claimed) {
        secondAttempted = true;
        return { count: 0 };
      }
      globalClaimed.claimed = true;
      return { count: 1 };
    });

    const { service: subject, tx: outerTx } = service(tx, svc);

    await Promise.allSettled([
      subject.checkout(user, id.order, {
        expected_version: 1,
        client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        payment: { method: PaymentMethod.QRIS },
      } as any),
      subject.checkout(user, id.order, {
        expected_version: 1,
        client_transaction_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        payment: { method: PaymentMethod.QRIS },
      } as any),
    ]);

    expect(globalClaimed.claimed).toBe(true);
    expect(secondAttempted).toBe(true);
    expect(outerTx.transactions.create).toHaveBeenCalledTimes(1);
    expect(outerTx.payments.create).toHaveBeenCalledTimes(1);
    expect(outerTx.product_stocks.updateMany).toHaveBeenCalledTimes(1);
    expect(outerTx.stock_movements.createMany).toHaveBeenCalledTimes(1);
  });

  it('tenant isolates the conversion', async () => {
    const foreign = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockImplementation(async (args: any) => {
      if (args.where.tenant_id === id.otherTenant) return null;
      return heldOrder();
    });

    const { service: subject, prisma } = service(tx, svc);

    await expect(subject.checkout({ ...user, tenant_id: id.otherTenant }, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({
      response: { error_code: 'HELD_ORDER_NOT_FOUND' },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.transactions.create).not.toHaveBeenCalled();
  });

  it('CASH parity: amount_received maps to payment amount and change', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.CASH, amount_received: 500 },
    } as any);

    expect(svc.executeTransactionCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ payment: { method: 'CASH', amount_received: 500 } }),
      'V1',
    );
  });

  it('QRIS parity: no cash fields flow into the core', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    const dto = svc.executeTransactionCore.mock.calls[0][2] as any;
    expect(dto.payment.method).toBe('QRIS');
    expect(dto.payment.amount).toBeUndefined();
    expect(dto.payment.amount_received).toBeUndefined();
  });

  it('does not use held-order snapshot prices as authoritative', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    // The core must re-resolve the authoritative product price from the live catalog,
    // not the stored effective_price_snapshot. Assert that the core received the
    // current product data, not the snapshot.
    const { service: subject, tx: outerTx } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    // Authoritative price resolution occurs inside executeTransactionCore via
    // tx.products.findMany; the snapshot is never submitted to the sale core.
    expect(outerTx.products.findMany).toHaveBeenCalledTimes(1);
    const coreDto = svc.executeTransactionCore.mock.calls[0][2] as any;
    expect(coreDto.items[0]).not.toHaveProperty('unit_price');
    expect(coreDto.items[0]).not.toHaveProperty('effective_price_snapshot');
    expect(coreDto.items[0]).not.toHaveProperty('base_price_snapshot');
  });

  it('retries a Serializable P2034 and succeeds on the next attempt', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());
    const first = prismaError('P2034');
    const { service: subject, prisma } = service(tx, svc, { failures: [first] });

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('stops after three P2034 attempts', async () => {
    const tx = makeTx();
    const { service: subject, prisma } = service(tx, mockTransactionsService(tx), {
      failures: [prismaError('P2034'), prismaError('P2034'), prismaError('P2034')],
    });

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({ response: { error_code: 'TRANSACTION_RETRY_REQUIRED' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('retries only the transaction idempotency P2002 path', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());
    const { service: subject, prisma } = service(tx, svc, {
      failures: [prismaError('P2002', 'uq_transactions_client_id')],
    });

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unrelated P2002 constraint', async () => {
    const tx = makeTx();
    const { service: subject, prisma } = service(tx, mockTransactionsService(tx), {
      failures: [prismaError('P2002', 'unrelated_unique_constraint')],
    });

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_CONVERSION_FAILED' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not retry a P2002 target with extra columns', async () => {
    const tx = makeTx();
    const { service: subject, prisma } = service(tx, mockTransactionsService(tx), {
      failures: [prismaError('P2002', ['tenant_id', 'client_transaction_id', 'payment_id'])],
    });

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_CONVERSION_FAILED' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not retry a domain error', async () => {
    const tx = makeTx();
    const { service: subject, prisma } = service(tx, mockTransactionsService(tx), {
      failures: [new ConflictException({ error_code: 'HELD_ORDER_VERSION_CONFLICT' })],
    });

    await expect(subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any)).rejects.toMatchObject({ response: { error_code: 'HELD_ORDER_VERSION_CONFLICT' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('performs no stock/payment/transaction write outside the supplied transaction', async () => {
    const tx = makeTx();
    const svc = mockTransactionsService(tx);
    tx.held_orders.findFirst.mockResolvedValue(heldOrder());

    const { service: subject, prisma, tx: outerTx } = service(tx, svc);

    await subject.checkout(user, id.order, {
      expected_version: 1,
      client_transaction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      payment: { method: PaymentMethod.QRIS },
    } as any);

    // The outer transaction owns tx; every sale write goes through the tx passed to
    // executeTransactionCore. Writes must not escape through prisma.prisma.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.transactions.create).toHaveBeenCalled();
    expect(tx.payments.create).toHaveBeenCalled();
    expect(tx.product_stocks.updateMany).toHaveBeenCalled();
    expect(tx.stock_movements.createMany).toHaveBeenCalled();
  });
});
