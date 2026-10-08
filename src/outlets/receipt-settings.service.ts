import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import type { ReceiptSettingsResponseDto } from './dto/receipt-settings-response.dto';
import type { UpdateReceiptSettingsDto } from './dto/update-receipt-settings.dto';

const receiptSettingsSelect = {
  tenant_id: true,
  outlet_id: true,
  header_store_name: true,
  header_outlet_name: true,
  header_address: true,
  header_phone: true,
  header_additional_text: true,
  show_sku: true,
  show_modifiers: true,
  show_item_notes: true,
  show_cashier: true,
  show_customer: true,
  footer_thank_you_text: true,
  footer_promo_text: true,
  template_version: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.receipt_settingsSelect;

type ActorScope = {
  tenantId: string;
  role: 'OWNER' | 'ADMIN' | 'CASHIER';
  outletId: string | null;
};

type OutletDefaults = {
  id: string;
  name: string;
  address: string | null;
  tenants: { name: string };
};

const editableFields = [
  'header_store_name',
  'header_outlet_name',
  'header_address',
  'header_phone',
  'header_additional_text',
  'show_sku',
  'show_modifiers',
  'show_item_notes',
  'show_cashier',
  'show_customer',
  'footer_thank_you_text',
  'footer_promo_text',
] as const satisfies readonly (keyof UpdateReceiptSettingsDto)[];

@Injectable()
export class ReceiptSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get(user: JwtPayload, outletId: string): Promise<ReceiptSettingsResponseDto> {
    const normalizedOutletId = this.outletId(outletId);
    return this.prisma.$transaction(
      async (tx) => {
        const scope = await this.actorScope(tx, user);
        this.assertOutletAccess(scope, normalizedOutletId);
        const outlet = await this.findOutlet(
          tx,
          scope.tenantId,
          normalizedOutletId,
        );
        const settings = await tx.receipt_settings.findUnique({
          where: {
            tenant_id_outlet_id: {
              tenant_id: scope.tenantId,
              outlet_id: normalizedOutletId,
            },
          },
          select: receiptSettingsSelect,
        });

        return settings ?? this.defaults(scope.tenantId, outlet);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  put(
    user: JwtPayload,
    outletId: string,
    dto: UpdateReceiptSettingsDto,
  ): Promise<ReceiptSettingsResponseDto> {
    const normalizedOutletId = this.outletId(outletId);
    const data = this.writeData(dto);

    return this.prisma.$transaction(
      async (tx) => {
        const scope = await this.actorScope(tx, user);
        if (!['OWNER', 'ADMIN'].includes(scope.role)) {
          throw new ForbiddenException('Role cannot update receipt settings');
        }
        await this.findOutlet(tx, scope.tenantId, normalizedOutletId);

        return tx.receipt_settings.upsert({
          where: {
            tenant_id_outlet_id: {
              tenant_id: scope.tenantId,
              outlet_id: normalizedOutletId,
            },
          },
          create: {
            tenant_id: scope.tenantId,
            outlet_id: normalizedOutletId,
            ...data,
          },
          update: data,
          select: receiptSettingsSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async actorScope(
    tx: Prisma.TransactionClient,
    user: JwtPayload,
  ): Promise<ActorScope> {
    if (!user || !isUUID(user.sub) || !isUUID(user.tenant_id)) {
      throw new UnauthorizedException('Invalid user context');
    }
    const tenantId = user.tenant_id.toLowerCase();
    const actor = await tx.users.findFirst({
      where: {
        id: user.sub.toLowerCase(),
        tenant_id: tenantId,
        is_active: true,
        tenants: { is_active: true },
      },
      select: { role: true, outlet_id: true },
    });
    if (!actor) {
      throw new UnauthorizedException('User or tenant is inactive');
    }
    if (!['OWNER', 'ADMIN', 'CASHIER'].includes(actor.role)) {
      throw new ForbiddenException('Role cannot access receipt settings');
    }

    return {
      tenantId,
      role: actor.role as ActorScope['role'],
      outletId: actor.outlet_id,
    };
  }

  private assertOutletAccess(scope: ActorScope, outletId: string): void {
    if (scope.role === 'CASHIER' && scope.outletId !== outletId) {
      throw new ForbiddenException('Outlet access denied');
    }
  }

  private async findOutlet(
    tx: Prisma.TransactionClient,
    tenantId: string,
    outletId: string,
  ): Promise<OutletDefaults> {
    const outlet = await tx.outlets.findFirst({
      where: { id: outletId, tenant_id: tenantId, is_active: true },
      select: {
        id: true,
        name: true,
        address: true,
        tenants: { select: { name: true } },
      },
    });
    if (!outlet) {
      throw new NotFoundException('Outlet not found');
    }
    return outlet;
  }

  private defaults(
    tenantId: string,
    outlet: OutletDefaults,
  ): ReceiptSettingsResponseDto {
    return {
      tenant_id: tenantId,
      outlet_id: outlet.id,
      header_store_name: outlet.tenants.name,
      header_outlet_name: outlet.name,
      header_address: outlet.address,
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
    };
  }

  private writeData(dto: UpdateReceiptSettingsDto) {
    for (const field of editableFields) {
      if (
        !Object.prototype.hasOwnProperty.call(dto, field) ||
        dto[field] === undefined
      ) {
        throw new BadRequestException(`${field} is required`);
      }
    }

    return {
      header_store_name: dto.header_store_name,
      header_outlet_name: dto.header_outlet_name,
      header_address: dto.header_address,
      header_phone: dto.header_phone,
      header_additional_text: dto.header_additional_text,
      show_sku: dto.show_sku,
      show_modifiers: dto.show_modifiers,
      show_item_notes: dto.show_item_notes,
      show_cashier: dto.show_cashier,
      show_customer: dto.show_customer,
      footer_thank_you_text: dto.footer_thank_you_text,
      footer_promo_text: dto.footer_promo_text,
      template_version: 1,
    };
  }

  private outletId(value: string): string {
    if (!isUUID(value)) {
      throw new BadRequestException('Invalid outlet ID');
    }
    return value.toLowerCase();
  }
}
