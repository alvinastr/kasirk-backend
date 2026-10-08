import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import type { UpdateReceiptSettingsDto } from './dto/update-receipt-settings.dto';
import { ReceiptSettingsController } from './receipt-settings.controller';
import type { ReceiptSettingsService } from './receipt-settings.service';

describe('ReceiptSettingsController', () => {
  let controller: ReceiptSettingsController;
  let service: { get: jest.Mock; put: jest.Mock };

  const user: JwtPayload = {
    sub: '30000000-0000-4000-8000-000000000001',
    tenant_id: '10000000-0000-4000-8000-000000000001',
    outlet_id: null,
    role: 'OWNER',
  };
  const outletId = '20000000-0000-4000-8000-000000000001';
  const dto = {
    header_store_name: 'Store',
    header_outlet_name: 'Outlet',
    header_address: null,
    header_phone: null,
    header_additional_text: null,
    show_sku: true,
    show_modifiers: true,
    show_item_notes: true,
    show_cashier: true,
    show_customer: true,
    footer_thank_you_text: 'Terima kasih',
    footer_promo_text: null,
  } as UpdateReceiptSettingsDto;

  beforeEach(() => {
    service = { get: jest.fn(), put: jest.fn() };
    controller = new ReceiptSettingsController(
      service as unknown as ReceiptSettingsService,
    );
  });

  it('delegates GET with user and route outlet', async () => {
    service.get.mockResolvedValue({ outlet_id: outletId });

    await expect(controller.get(user, outletId)).resolves.toEqual({
      outlet_id: outletId,
    });
    expect(service.get).toHaveBeenCalledWith(user, outletId);
  });

  it('delegates PUT with user, route outlet, and DTO', async () => {
    service.put.mockResolvedValue({ outlet_id: outletId });

    await expect(controller.put(user, outletId, dto)).resolves.toEqual({
      outlet_id: outletId,
    });
    expect(service.put).toHaveBeenCalledWith(user, outletId, dto);
  });
});
