import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import type { PrismaService } from '../prisma/prisma.service';
import type { UpdateReceiptSettingsDto } from './dto/update-receipt-settings.dto';
import { ReceiptSettingsService } from './receipt-settings.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const outletId = '20000000-0000-4000-8000-000000000001';
const otherOutletId = '20000000-0000-4000-8000-000000000002';
const userId = '30000000-0000-4000-8000-000000000001';

const owner: JwtPayload = {
  sub: userId,
  tenant_id: tenantId,
  outlet_id: null,
  role: 'OWNER',
};

const input: UpdateReceiptSettingsDto = {
  header_store_name: 'Configured Store',
  header_outlet_name: 'Configured Outlet',
  header_address: 'Configured Address',
  header_phone: '08123456789',
  header_additional_text: 'Open daily',
  show_sku: false,
  show_modifiers: true,
  show_item_notes: false,
  show_cashier: true,
  show_customer: false,
  footer_thank_you_text: 'Thank you',
  footer_promo_text: 'Come again',
};

describe('ReceiptSettingsService', () => {
  let service: ReceiptSettingsService;
  let tx: any;
  let prisma: any;

  beforeEach(() => {
    tx = {
      users: { findFirst: jest.fn() },
      outlets: { findFirst: jest.fn() },
      receipt_settings: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    };
    service = new ReceiptSettingsService(prisma as unknown as PrismaService);
    tx.users.findFirst.mockResolvedValue({ role: 'OWNER', outlet_id: null });
    tx.outlets.findFirst.mockResolvedValue({
      id: outletId,
      name: 'Outlet Pusat',
      address: 'Jl. Utama 1',
      tenants: { name: 'KasirKita Store' },
    });
  });

  it('synthesizes defaults without creating a settings row', async () => {
    tx.receipt_settings.findUnique.mockResolvedValue(null);

    const result = await service.get(owner, outletId);

    expect(result).toEqual({
      tenant_id: tenantId,
      outlet_id: outletId,
      header_store_name: 'KasirKita Store',
      header_outlet_name: 'Outlet Pusat',
      header_address: 'Jl. Utama 1',
      header_phone: null,
      header_additional_text: null,
      show_sku: true,
      show_modifiers: true,
      show_item_notes: true,
      show_cashier: true,
      show_customer: true,
      footer_thank_you_text: 'Terima kasih',
      footer_promo_text: null,
      template_version: 1,
      created_at: null,
      updated_at: null,
    });
    expect(tx.receipt_settings.upsert).not.toHaveBeenCalled();
  });

  it('returns a stored settings row unchanged', async () => {
    const stored = {
      tenant_id: tenantId,
      outlet_id: outletId,
      ...input,
      template_version: 1,
      created_at: new Date('2026-10-08T00:00:00Z'),
      updated_at: new Date('2026-10-08T00:00:00Z'),
    };
    tx.receipt_settings.findUnique.mockResolvedValue(stored);

    await expect(service.get(owner, outletId)).resolves.toBe(stored);
  });

  it('atomically upserts with JWT tenant and supports nullable clearing', async () => {
    const saved = {
      tenant_id: tenantId,
      outlet_id: outletId,
      ...input,
      header_phone: null,
      footer_promo_text: null,
      template_version: 1,
    };
    tx.receipt_settings.upsert.mockResolvedValue(saved);

    const result = await service.put(owner, outletId, {
      ...input,
      header_phone: null,
      footer_promo_text: null,
    });

    expect(result).toBe(saved);
    expect(tx.receipt_settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_outlet_id: {
            tenant_id: tenantId,
            outlet_id: outletId,
          },
        },
        create: expect.objectContaining({
          tenant_id: tenantId,
          outlet_id: outletId,
          header_phone: null,
          footer_promo_text: null,
          template_version: 1,
        }),
        update: expect.objectContaining({
          header_phone: null,
          footer_promo_text: null,
          template_version: 1,
        }),
      }),
    );
    const upsert = tx.receipt_settings.upsert.mock.calls[0][0];
    expect(upsert.update).toEqual({
      ...input,
      header_phone: null,
      footer_promo_text: null,
      template_version: 1,
    });
  });

  it('allows an active ADMIN to upsert settings', async () => {
    tx.users.findFirst.mockResolvedValue({ role: 'ADMIN', outlet_id: null });
    tx.receipt_settings.upsert.mockResolvedValue({
      tenant_id: tenantId,
      outlet_id: outletId,
      ...input,
      template_version: 1,
    });

    await expect(
      service.put({ ...owner, role: 'ADMIN' }, outletId, input),
    ).resolves.toEqual(expect.objectContaining({ outlet_id: outletId }));
    expect(tx.receipt_settings.upsert).toHaveBeenCalledTimes(1);
  });

  it('denies CASHIER writes even when JWT claims OWNER', async () => {
    tx.users.findFirst.mockResolvedValue({
      role: 'CASHIER',
      outlet_id: outletId,
    });

    await expect(service.put(owner, outletId, input)).rejects.toThrow(
      ForbiddenException,
    );
    expect(tx.receipt_settings.upsert).not.toHaveBeenCalled();
  });

  it('rejects an omitted editable field before retaining stored data', async () => {
    const incomplete = { ...input } as Partial<UpdateReceiptSettingsDto>;
    delete incomplete.header_phone;

    expect(() =>
      service.put(owner, outletId, incomplete as UpdateReceiptSettingsDto),
    ).toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows CASHIER reads only for the assigned outlet', async () => {
    tx.users.findFirst.mockResolvedValue({
      role: 'CASHIER',
      outlet_id: outletId,
    });
    tx.receipt_settings.findUnique.mockResolvedValue(null);
    const cashier = { ...owner, role: 'CASHIER', outlet_id: outletId };

    await expect(service.get(cashier, outletId)).resolves.toBeDefined();
    await expect(service.get(cashier, otherOutletId)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('uses a tenant-scoped outlet lookup and hides foreign outlets', async () => {
    tx.outlets.findFirst.mockResolvedValue(null);

    await expect(service.get(owner, otherOutletId)).rejects.toThrow(
      NotFoundException,
    );
    expect(tx.outlets.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: otherOutletId,
          tenant_id: tenantId,
          is_active: true,
        },
      }),
    );
  });

  it.each([
    ['OWNER', { role: 'OWNER', outlet_id: null }],
    ['ADMIN', { role: 'ADMIN', outlet_id: null }],
    ['assigned CASHIER', { role: 'CASHIER', outlet_id: outletId }],
  ])(
    'returns not found for an inactive outlet as %s',
    async (_label, actor) => {
      tx.users.findFirst.mockResolvedValue(actor);
      tx.outlets.findFirst.mockResolvedValue(null);

      await expect(
        service.get(
          { ...owner, role: actor.role, outlet_id: actor.outlet_id },
          outletId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(tx.outlets.findFirst).toHaveBeenCalledTimes(1);
      expect(tx.receipt_settings.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each(['OWNER', 'ADMIN'])(
    'returns not found when %s updates an inactive outlet',
    async (role) => {
      tx.users.findFirst.mockResolvedValue({ role, outlet_id: null });
      tx.outlets.findFirst.mockResolvedValue(null);

      await expect(
        service.put({ ...owner, role }, outletId, input),
      ).rejects.toThrow(NotFoundException);
      expect(tx.outlets.findFirst).toHaveBeenCalledTimes(1);
      expect(tx.receipt_settings.upsert).not.toHaveBeenCalled();
    },
  );
});
