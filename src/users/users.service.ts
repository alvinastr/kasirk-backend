import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { SetUserPinDto } from './dto/set-user-pin.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: JwtPayload) {
    return this.prisma.users.findMany({
      where: {
        tenant_id: user.tenant_id,
        is_active: true,
      },

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        outlet_id: true,
        created_at: true,
      },
    });
  }

  async create(user: JwtPayload, dto: CreateUserDto) {
    if (dto.outlet_id != null) {
      const outlet = await this.prisma.outlets.findFirst({
        where: { id: dto.outlet_id, tenant_id: user.tenant_id },
        select: { id: true },
      });
      if (!outlet) {
        throw new NotFoundException('Outlet not found');
      }
    }

    const password_hash = await bcrypt.hash(dto.password, 10);

    return this.prisma.users.create({
      data: {
        tenant_id: user.tenant_id,
        name: dto.name,
        email: dto.email,
        password_hash,
        role: dto.role,
        outlet_id: dto.outlet_id,
      },
      select: {
        id: true,
        tenant_id: true,
        name: true,
        email: true,
        role: true,
        outlet_id: true,
        is_active: true,
        created_at: true,
      },
    });
  }

  async setPin(
    user: JwtPayload,
    targetUserId: string,
    dto: SetUserPinDto,
  ): Promise<void> {
    const target = await this.prisma.users.findFirst({
      where: {
        id: targetUserId,
        tenant_id: user.tenant_id,
        is_active: true,
      },
      select: {
        id: true,
      },
    });

    if (!target) {
      throw this.userNotFound();
    }

    const pinHash = await bcrypt.hash(dto.pin, 10);
    const result = await this.prisma.users.updateMany({
      where: {
        id: target.id,
        tenant_id: user.tenant_id,
        is_active: true,
      },
      data: {
        pin_hash: pinHash,
        pin_changed_at: new Date(),
        pin_failed_attempts: 0,
        locked_until: null,
      },
    });

    if (result.count !== 1) {
      throw this.userNotFound();
    }
  }

  private userNotFound(): NotFoundException {
    return new NotFoundException({
      error_code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
  }
}
