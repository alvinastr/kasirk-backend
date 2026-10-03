import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

export interface BootstrapInputs {
  storeCode: string;
  tenantName: string;
  tenantAddress?: string;
  outletName: string;
  outletAddress?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerPin: string;
}

export interface BootstrapResult {
  tenantId: string;
  storeCode: string;
  outletId: string;
  ownerId: string;
  ownerEmail: string;
}

@Injectable()
export class ProductionBootstrapService {
  constructor(private prisma: PrismaService) {}

  async bootstrap(inputs: BootstrapInputs): Promise<BootstrapResult> {
    this.validateInputs(inputs);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const tenantCount = await tx.tenants.count();
        const userCount = await tx.users.count();
        const outletCount = await tx.outlets.count();

        if (tenantCount > 0 || userCount > 0 || outletCount > 0) {
          throw new Error(
            'Production bootstrap refused: business data already exists',
          );
        }

        const tenant = await tx.tenants.create({
          data: {
            store_code: inputs.storeCode,
            name: inputs.tenantName,
            address: inputs.tenantAddress || null,
            is_active: true,
          },
        });

        const outlet = await tx.outlets.create({
          data: {
            tenant_id: tenant.id,
            name: inputs.outletName,
            address: inputs.outletAddress || null,
            is_active: true,
          },
        });

        const passwordHash = await bcrypt.hash(inputs.ownerPassword, 10);
        const pinHash = await bcrypt.hash(inputs.ownerPin, 10);

        const owner = await tx.users.create({
          data: {
            tenant_id: tenant.id,
            outlet_id: null,
            name: inputs.ownerName,
            email: inputs.ownerEmail,
            password_hash: passwordHash,
            pin_hash: pinHash,
            role: 'OWNER',
            pin_failed_attempts: 0,
            locked_until: null,
            pin_changed_at: new Date(),
            is_active: true,
          },
        });

        return {
          tenantId: tenant.id,
          storeCode: tenant.store_code ?? inputs.storeCode,
          outletId: outlet.id,
          ownerId: owner.id,
          ownerEmail: owner.email,
        };
      },
      {
        isolationLevel: 'Serializable',
      },
    );

    return result;
  }

  private validateInputs(inputs: BootstrapInputs): void {
    const storeCodeRegex = /^[A-Z0-9-]{3,32}$/;
    if (!storeCodeRegex.test(inputs.storeCode)) {
      throw new Error('Store code must match ^[A-Z0-9-]{3,32}$');
    }

    if (!inputs.tenantName || inputs.tenantName.trim().length === 0) {
      throw new Error('Tenant name is required');
    }

    if (inputs.tenantName.length > 100) {
      throw new Error('Tenant name exceeds 100 characters');
    }

    if (!inputs.outletName || inputs.outletName.trim().length === 0) {
      throw new Error('Outlet name is required');
    }

    if (inputs.outletName.length > 100) {
      throw new Error('Outlet name exceeds 100 characters');
    }

    if (!inputs.ownerName || inputs.ownerName.trim().length === 0) {
      throw new Error('Owner name is required');
    }

    if (inputs.ownerName.length > 150) {
      throw new Error('Owner name exceeds 150 characters');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inputs.ownerEmail)) {
      throw new Error('Valid email is required');
    }

    if (inputs.ownerEmail.length > 255) {
      throw new Error('Email exceeds 255 characters');
    }

    if (!inputs.ownerPassword || inputs.ownerPassword.length === 0) {
      throw new Error('Owner password is required');
    }

    if (Buffer.byteLength(inputs.ownerPassword, 'utf8') > 72) {
      throw new Error('Password exceeds bcrypt 72-byte limit');
    }

    const pinRegex = /^\d{6}$/;
    if (!pinRegex.test(inputs.ownerPin)) {
      throw new Error('PIN must be exactly 6 digits');
    }
  }
}
