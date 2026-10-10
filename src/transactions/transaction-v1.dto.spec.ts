import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from '@jest/globals';
import { CreateTransactionDto } from './dto/create-transaction.dto';

const ids = {
  client: '11111111-1111-4111-8111-111111111111',
  outlet: '22222222-2222-4222-8222-222222222222',
  session: '33333333-3333-4333-8333-333333333333',
  product: '44444444-4444-4444-8444-444444444444',
  option: '55555555-5555-4555-8555-555555555555',
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    client_transaction_id: ids.client,
    outlet_id: ids.outlet,
    cashier_session_id: ids.session,
    items: [{ product_id: ids.product, quantity: 1, modifier_option_ids: [ids.option] }],
    payment: { method: 'CASH', amount: 10_000 },
    ...overrides,
  };
}

async function errors(input: Record<string, unknown>) {
  return validate(plainToInstance(CreateTransactionDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('CreateTransactionDto V1', () => {
  it('requires cashier_session_id', async () => {
    const input = payload();
    delete input.cashier_session_id;
    await expect(errors(input)).resolves.not.toHaveLength(0);
  });

  it('allows duplicate product lines with distinct notes', async () => {
    await expect(errors(payload({
      items: [
        { product_id: ids.product, quantity: 1, note: 'no sugar', modifier_option_ids: [] },
        { product_id: ids.product, quantity: 1, note: 'extra ice', modifier_option_ids: [] },
      ],
    }))).resolves.toHaveLength(0);
  });

  it('rejects an explicit null note and notes longer than 255 characters', async () => {
    await expect(errors(payload({ items: [{ product_id: ids.product, quantity: 1, note: null }] }))).resolves.not.toHaveLength(0);
    await expect(errors(payload({ items: [{ product_id: ids.product, quantity: 1, note: 'x'.repeat(256) }] }))).resolves.not.toHaveLength(0);
  });

  it('rejects duplicate modifier option IDs in one line', async () => {
    await expect(errors(payload({
      items: [{ product_id: ids.product, quantity: 1, modifier_option_ids: [ids.option, ids.option] }],
    }))).resolves.not.toHaveLength(0);
  });

  it('accepts V1 CASH amount_received and legacy CASH amount transport shapes', async () => {
    await expect(errors(payload({ payment: { method: 'CASH', amount_received: 10_000 } }))).resolves.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'CASH', amount: 10_000 } }))).resolves.toHaveLength(0);
  });

  it('rejects ambiguous CASH and CASH without tender in DTO validation', async () => {
    await expect(errors(payload({ payment: { method: 'CASH', amount: 10_000, amount_received: 10_000 } }))).resolves.not.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'CASH' } }))).resolves.not.toHaveLength(0);
  });

  it('accepts method-only QRIS and rejects typed cash fields on QRIS', async () => {
    await expect(errors(payload({ payment: { method: 'QRIS' } }))).resolves.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'QRIS', amount: 10_000 } }))).resolves.not.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'QRIS', amount_received: 10_000 } }))).resolves.not.toHaveLength(0);
  });

  it('accepts method-only EDC and rejects typed cash fields on EDC', async () => {
    await expect(errors(payload({ payment: { method: 'EDC' } }))).resolves.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'EDC', amount: 10_000 } }))).resolves.not.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'EDC', amount_received: 10_000 } }))).resolves.not.toHaveLength(0);
  });

  it('rejects non-integer, negative, and explicit-null cash tender fields', async () => {
    await expect(errors(payload({ payment: { method: 'CASH', amount_received: 10.5 } }))).resolves.not.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'CASH', amount_received: -1 } }))).resolves.not.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'CASH', amount_received: null } }))).resolves.not.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'CASH', amount: null } }))).resolves.not.toHaveLength(0);
  });

  it.each([
    ['omitted', undefined],
    ['null', null],
    ['string', 'CASH'],
    ['number', 1],
    ['array', []],
    ['empty object', {}],
  ])('rejects malformed payment object: %s', async (_case, payment) => {
    const input: Record<string, unknown> = payload();
    if (payment === undefined) {
      delete input.payment;
    } else {
      input.payment = payment;
    }
    await expect(errors(input)).resolves.not.toHaveLength(0);
  });

  it('rejects unsupported payment methods', async () => {
    await expect(errors(payload({ payment: { method: 'CARD', amount_received: 10_000 } }))).resolves.not.toHaveLength(0);
  });

  it('rejects client supplied change_amount as an unknown field', async () => {
    await expect(errors(payload({ payment: { method: 'CASH', amount_received: 10_000, change_amount: 0 } }))).resolves.not.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'QRIS', change_amount: 0 } }))).resolves.not.toHaveLength(0);
    await expect(errors(payload({ payment: { method: 'EDC', change_amount: 0 } }))).resolves.not.toHaveLength(0);
  });
});
