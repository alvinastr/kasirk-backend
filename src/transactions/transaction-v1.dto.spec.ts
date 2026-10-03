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
});
