import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueConstraintViolation } from '../common/utils/prisma-error.util';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto';
import { CreateModifierOptionDto } from './dto/create-modifier-option.dto';
import { UpdateModifierOptionDto } from './dto/update-modifier-option.dto';

@Injectable()
export class ModifierGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: JwtPayload) {
    return this.prisma.modifier_groups.findMany({
      where: { tenant_id: user.tenant_id },
      include: { options: { orderBy: { display_order: 'asc' } } },
      orderBy: { display_order: 'asc' },
    });
  }

  async findOne(user: JwtPayload, id: string) {
    const group = await this.prisma.modifier_groups.findFirst({
      where: { id, tenant_id: user.tenant_id },
      include: { options: { orderBy: { display_order: 'asc' } } },
    });
    if (!group) {
      throw new NotFoundException({
        error_code: 'MODIFIER_GROUP_NOT_FOUND',
        message: 'Modifier group not found',
      });
    }
    return group;
  }

  async create(user: JwtPayload, dto: CreateModifierGroupDto) {
    try {
      return await this.prisma.modifier_groups.create({
        data: {
          tenant_id: user.tenant_id,
          name: dto.name,
          is_active: dto.is_active ?? true,
          display_order: dto.display_order ?? 0,
        },
        include: { options: true },
      });
    } catch (error) {
      this.rethrowGroupWriteError(error);
    }
  }

  async update(user: JwtPayload, id: string, dto: UpdateModifierGroupDto) {
    const group = await this.prisma.modifier_groups.findFirst({
      where: { id, tenant_id: user.tenant_id },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException({
        error_code: 'MODIFIER_GROUP_NOT_FOUND',
        message: 'Modifier group not found',
      });
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    if (dto.display_order !== undefined) data.display_order = dto.display_order;

    try {
      return await this.prisma.modifier_groups.update({
        where: { id_tenant_id: { id, tenant_id: user.tenant_id } },
        data,
        include: { options: true },
      });
    } catch (error) {
      this.rethrowGroupWriteError(error);
    }
  }

  async remove(user: JwtPayload, id: string) {
    const group = await this.prisma.modifier_groups.findFirst({
      where: { id, tenant_id: user.tenant_id },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException({
        error_code: 'MODIFIER_GROUP_NOT_FOUND',
        message: 'Modifier group not found',
      });
    }
    return this.prisma.modifier_groups.update({
      where: { id_tenant_id: { id, tenant_id: user.tenant_id } },
      data: { is_active: false },
      include: { options: true },
    });
  }

  // --- Options ---

  async createOption(
    user: JwtPayload,
    groupId: string,
    dto: CreateModifierOptionDto,
  ) {
    await this.validateGroupOwnership(user.tenant_id, groupId);

    try {
      return await this.prisma.modifier_options.create({
        data: {
          tenant_id: user.tenant_id,
          modifier_group_id: groupId,
          name: dto.name,
          price_delta: dto.price_delta,
          is_active: dto.is_active ?? true,
          display_order: dto.display_order ?? 0,
        },
      });
    } catch (error) {
      this.rethrowOptionWriteError(error);
    }
  }

  async updateOption(
    user: JwtPayload,
    groupId: string,
    optionId: string,
    dto: UpdateModifierOptionDto,
  ) {
    const option = await this.prisma.modifier_options.findFirst({
      where: {
        id: optionId,
        modifier_group_id: groupId,
        tenant_id: user.tenant_id,
      },
      select: { id: true },
    });
    if (!option) {
      throw new NotFoundException({
        error_code: 'MODIFIER_OPTION_NOT_FOUND',
        message: 'Modifier option not found',
      });
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.price_delta !== undefined) data.price_delta = dto.price_delta;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    if (dto.display_order !== undefined) data.display_order = dto.display_order;

    try {
      return await this.prisma.modifier_options.update({
        where: { id: optionId },
        data,
      });
    } catch (error) {
      this.rethrowOptionWriteError(error);
    }
  }

  private async validateGroupOwnership(
    tenantId: string,
    groupId: string,
  ): Promise<void> {
    const group = await this.prisma.modifier_groups.findFirst({
      where: { id: groupId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException({
        error_code: 'MODIFIER_GROUP_NOT_FOUND',
        message: 'Modifier group not found',
      });
    }
  }

  private rethrowGroupWriteError(error: unknown): never {
    if (
      isUniqueConstraintViolation(error, 'uq_modifier_groups_tenant_name', [
        'tenant_id',
        'name',
      ])
    ) {
      throw new ConflictException({
        error_code: 'MODIFIER_GROUP_NAME_EXISTS',
        message: 'Modifier group name already exists in this tenant',
      });
    }
    throw error;
  }

  async removeOption(
    user: JwtPayload,
    groupId: string,
    optionId: string,
  ) {
    const option = await this.prisma.modifier_options.findFirst({
      where: {
        id: optionId,
        modifier_group_id: groupId,
        tenant_id: user.tenant_id,
      },
      select: { id: true },
    });
    if (!option) {
      throw new NotFoundException({
        error_code: 'MODIFIER_OPTION_NOT_FOUND',
        message: 'Modifier option not found',
      });
    }
    return this.prisma.modifier_options.update({
      where: { id: optionId },
      data: { is_active: false },
    });
  }

  private rethrowOptionWriteError(error: unknown): never {
    if (
      isUniqueConstraintViolation(error, 'uq_modifier_options_tenant_group_name', [
        'tenant_id',
        'modifier_group_id',
        'name',
      ])
    ) {
      throw new ConflictException({
        error_code: 'MODIFIER_OPTION_NAME_EXISTS',
        message: 'Modifier option name already exists in this group',
      });
    }
    throw error;
  }
}
