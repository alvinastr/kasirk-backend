import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, expect, it, jest } from '@jest/globals';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import {
  ReplaceProductModifierGroupItemDto,
  ReplaceProductModifierGroupsDto,
} from './dto/replace-product-modifier-groups.dto';

const user = {
  sub: 'user-1',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  role: 'ADMIN',
  outlet_id: null,
};

const productId = '22222222-2222-4222-8222-222222222222';
const activeGroupId = '33333333-3333-4333-8333-333333333333';
const secondGroupId = '44444444-4444-4444-8444-444444444444';
const inactiveGroupId = '55555555-5555-4555-8555-555555555555';

function makePrisma() {
  return {
    products: {
      findFirst: jest.fn(),
    },
    modifier_groups: {
      findMany: jest.fn(),
    },
    product_modifier_groups: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    categories: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function assignmentDto(overrides: Partial<ReplaceProductModifierGroupItemDto> = {}) {
  return {
    modifier_group_id: activeGroupId,
    required: false,
    selection_type: 'SINGLE' as const,
    display_order: 0,
    ...overrides,
  };
}

describe('ProductsService modifier assignment M2 behavior', () => {
  it('getModifierGroups validates product tenant ownership and returns active groups/options only', async () => {
    const prisma = makePrisma();
    prisma.products.findFirst.mockResolvedValueOnce({ id: productId } as never);
    prisma.product_modifier_groups.findMany.mockResolvedValueOnce([
      {
        required: true,
        selection_type: 'SINGLE',
        display_order: 0,
        modifier_groups: {
          id: activeGroupId,
          name: 'Temperature',
          options: [{ id: 'opt-1', is_active: true }],
        },
      },
    ] as never);
    const service = new ProductsService(prisma as never);

    await expect(service.getModifierGroups(user, productId)).resolves.toEqual({
      product_id: productId,
      modifier_groups: [
        {
          id: activeGroupId,
          name: 'Temperature',
          required: true,
          selection_type: 'SINGLE',
          display_order: 0,
          options: [{ id: 'opt-1', is_active: true }],
        },
      ],
    });
    expect(prisma.products.findFirst).toHaveBeenCalledWith({
      where: { id: productId, tenant_id: user.tenant_id },
      select: { id: true },
    });
    expect(prisma.product_modifier_groups.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: user.tenant_id,
        product_id: productId,
        modifier_groups: { is_active: true },
      },
      include: {
        modifier_groups: {
          include: {
            options: {
              where: { is_active: true },
              orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
      orderBy: [{ display_order: 'asc' }, { modifier_group_id: 'asc' }],
    });
  });

  it('getModifierGroups rejects unknown or cross-tenant product', async () => {
    const prisma = makePrisma();
    prisma.products.findFirst.mockResolvedValueOnce(null as never);
    const service = new ProductsService(prisma as never);

    await expect(service.getModifierGroups(user, productId)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.product_modifier_groups.findMany).not.toHaveBeenCalled();
  });

  it('replaceModifierGroups rejects duplicate modifier group assignments before writes', async () => {
    const prisma = makePrisma();
    prisma.products.findFirst.mockResolvedValueOnce({ id: productId } as never);
    const service = new ProductsService(prisma as never);

    await expect(
      service.replaceModifierGroups(user, productId, {
        modifier_groups: [assignmentDto(), assignmentDto()],
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.product_modifier_groups.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replaceModifierGroups rejects invalid selection flags before writes', async () => {
    const prisma = makePrisma();
    prisma.products.findFirst.mockResolvedValue({ id: productId } as never);
    const service = new ProductsService(prisma as never);

    await expect(
      service.replaceModifierGroups(user, productId, {
        modifier_groups: [assignmentDto({ selection_type: 'MANY' as never })],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.replaceModifierGroups(user, productId, {
        modifier_groups: [assignmentDto({ required: true, selection_type: 'MULTIPLE' })],
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.product_modifier_groups.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replaceModifierGroups validates every assigned group is active and tenant-owned', async () => {
    const prisma = makePrisma();
    prisma.products.findFirst.mockResolvedValueOnce({ id: productId } as never);
    prisma.modifier_groups.findMany.mockResolvedValueOnce([{ id: activeGroupId }] as never);
    const service = new ProductsService(prisma as never);

    await expect(
      service.replaceModifierGroups(user, productId, {
        modifier_groups: [
          assignmentDto({ modifier_group_id: activeGroupId }),
          assignmentDto({ modifier_group_id: inactiveGroupId }),
        ],
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.modifier_groups.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: user.tenant_id,
        id: { in: [activeGroupId, inactiveGroupId] },
        is_active: true,
      },
      select: { id: true },
    });
    expect(prisma.product_modifier_groups.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replaceModifierGroups deletes and inserts in one transaction with assignment flags', async () => {
    const prisma = makePrisma();
    const deleteOp = Promise.resolve({ count: 1 });
    const createOp = Promise.resolve({ count: 2 });
    prisma.products.findFirst.mockResolvedValue({ id: productId } as never);
    prisma.modifier_groups.findMany.mockResolvedValue([
      { id: activeGroupId },
      { id: secondGroupId },
    ] as never);
    prisma.product_modifier_groups.deleteMany.mockReturnValue(deleteOp as never);
    prisma.product_modifier_groups.createMany.mockReturnValue(createOp as never);
    prisma.$transaction.mockResolvedValueOnce([{ count: 1 }, { count: 2 }] as never);
    prisma.product_modifier_groups.findMany.mockResolvedValueOnce([] as never);
    const service = new ProductsService(prisma as never);

    await service.replaceModifierGroups(user, productId, {
      modifier_groups: [
        assignmentDto({ modifier_group_id: activeGroupId, required: true, selection_type: 'SINGLE', display_order: 0 }),
        assignmentDto({ modifier_group_id: secondGroupId, required: false, selection_type: 'MULTIPLE', display_order: 1 }),
      ],
    });

    expect(prisma.product_modifier_groups.deleteMany).toHaveBeenCalledWith({
      where: { tenant_id: user.tenant_id, product_id: productId },
    });
    expect(prisma.product_modifier_groups.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenant_id: user.tenant_id,
          product_id: productId,
          modifier_group_id: activeGroupId,
          required: true,
          selection_type: 'SINGLE',
          display_order: 0,
        },
        {
          tenant_id: user.tenant_id,
          product_id: productId,
          modifier_group_id: secondGroupId,
          required: false,
          selection_type: 'MULTIPLE',
          display_order: 1,
        },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([deleteOp, createOp]);
  });

  it('replaceModifierGroups clears assignments atomically when replacement list is empty', async () => {
    const prisma = makePrisma();
    const deleteOp = Promise.resolve({ count: 3 });
    prisma.products.findFirst.mockResolvedValue({ id: productId } as never);
    prisma.product_modifier_groups.deleteMany.mockReturnValue(deleteOp as never);
    prisma.$transaction.mockResolvedValueOnce([{ count: 3 }] as never);
    prisma.product_modifier_groups.findMany.mockResolvedValueOnce([] as never);
    const service = new ProductsService(prisma as never);

    await service.replaceModifierGroups(user, productId, { modifier_groups: [] });

    expect(prisma.modifier_groups.findMany).not.toHaveBeenCalled();
    expect(prisma.product_modifier_groups.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith([deleteOp]);
  });
});

describe('Product modifier assignment DTO validation', () => {
  it('rejects negative, fractional, null, unknown selection type, and malformed UUID fields', async () => {
    await expect(
      validate(plainToInstance(ReplaceProductModifierGroupItemDto, assignmentDto({ display_order: -1 }))),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(ReplaceProductModifierGroupItemDto, assignmentDto({ display_order: 1.5 }))),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(ReplaceProductModifierGroupItemDto, assignmentDto({ display_order: null as never }))),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(ReplaceProductModifierGroupItemDto, assignmentDto({ selection_type: 'OPTIONAL' as never }))),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(ReplaceProductModifierGroupItemDto, assignmentDto({ modifier_group_id: 'not-a-uuid' }))),
    ).resolves.toHaveLength(1);
  });

  it('rejects duplicate groups case-insensitively and strips unknown tenant fields', async () => {
    const duplicateDto = plainToInstance(ReplaceProductModifierGroupsDto, {
      modifier_groups: [
        assignmentDto({ modifier_group_id: activeGroupId.toUpperCase() }),
        assignmentDto({ modifier_group_id: activeGroupId.toLowerCase() }),
      ],
    });
    await expect(validate(duplicateDto)).resolves.toHaveLength(1);

    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = await pipe.transform(
      {
        modifier_groups: [{ ...assignmentDto(), tenant_id: user.tenant_id }],
        tenant_id: user.tenant_id,
      },
      { type: 'body', metatype: ReplaceProductModifierGroupsDto },
    );

    expect(result).toEqual({ modifier_groups: [assignmentDto()] });
    expect(result).not.toHaveProperty('tenant_id');
    expect(result.modifier_groups[0]).not.toHaveProperty('tenant_id');
  });
});

describe('ProductsController modifier RBAC metadata', () => {
  const reflector = new Reflector();

  it('applies JWT and roles guards at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ProductsController);

    expect(guards).toEqual([JwtGuard, RolesGuard]);
  });

  it('allows reads for any authenticated role and restricts replacement writes to OWNER or ADMIN', () => {
    expect(reflector.get(ROLES_KEY, ProductsController.prototype.getModifierGroups)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, ProductsController.prototype.replaceModifierGroups)).toEqual([
      'OWNER',
      'ADMIN',
    ]);
  });
});
