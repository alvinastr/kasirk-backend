import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateReceiptSettingsDto } from './update-receipt-settings.dto';

const validBody = (overrides: Record<string, unknown> = {}) => ({
  header_store_name: 'Store',
  header_outlet_name: 'Outlet',
  header_address: 'Address',
  header_phone: '08123456789',
  header_additional_text: 'Open daily',
  show_sku: true,
  show_modifiers: true,
  show_item_notes: true,
  show_cashier: true,
  show_customer: true,
  footer_thank_you_text: 'Terima kasih',
  footer_promo_text: 'Come again',
  ...overrides,
});

const errorsFor = async (body: Record<string, unknown>) =>
  validate(plainToInstance(UpdateReceiptSettingsDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('UpdateReceiptSettingsDto', () => {
  it('trims text and accepts null to clear optional fields', async () => {
    const instance = plainToInstance(
      UpdateReceiptSettingsDto,
      validBody({
        header_store_name: '  Store  ',
        header_address: null,
        header_phone: null,
        header_additional_text: null,
        footer_promo_text: null,
      }),
    );

    await expect(
      validate(instance, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toHaveLength(0);
    expect(instance.header_store_name).toBe('Store');
    expect(instance.header_phone).toBeNull();
  });

  it.each(['header_phone', 'show_customer'])(
    'rejects omitted required field %s',
    async (field) => {
      const body: Record<string, unknown> = validBody();
      delete body[field];

      expect(await errorsFor(body)).not.toHaveLength(0);
    },
  );

  it.each([
    ['blank required text', { header_store_name: '   ' }],
    ['blank optional text', { header_phone: '   ' }],
    ['overlong text', { footer_promo_text: 'x'.repeat(501) }],
    ['non-boolean flag', { show_sku: 'true' }],
    ['server-owned template version', { template_version: 1 }],
    ['unknown tenant identity', { tenant_id: 'foreign-tenant' }],
    ['unknown field', { unexpected: true }],
  ])('rejects %s', async (_label, override) => {
    expect(await errorsFor(validBody(override))).not.toHaveLength(0);
  });
});
