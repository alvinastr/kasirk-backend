import 'reflect-metadata';
import { ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import { ModifierGroupsController } from './modifier-groups.controller';
import { ModifierGroupsService } from './modifier-groups.service';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto';
import { CreateModifierOptionDto } from './dto/create-modifier-option.dto';
import { UpdateModifierOptionDto } from './dto/update-modifier-option.dto';

const user = {
  sub: 'user-1',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  role: 'ADMIN',
  outlet_id: null,
};

const otherTenantUser = {
  sub: 'user-2',
  tenant_id: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  outlet_id: null,
};

const groupId = '33333333-3333-4333-8333-333333333333';
const optionId = '44444444-4444-4444-8444-444444444444';

function prismaUnique(meta: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta,
  });
}

function makePrisma() {
  return {
    modifier_groups: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    modifier_options: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('ModifierGroupsService M2 behavior', () => {
  it('findAll reads only authenticated tenant groups with ordered options', async () => {
    const prisma = makePrisma();
    prisma.modifier_groups.findMany.mockResolvedValueOnce([{ id: groupId }] as never);
    const service = new ModifierGroupsService(prisma as never);

    await expect(service.findAll(user)).resolves.toEqual([{ id: groupId }]);

    expect(prisma.modifier_groups.findMany).toHaveBeenCalledWith({
      where: { tenant_id: user.tenant_id },
      include: { options: { orderBy: { display_order: 'asc' } } },
      orderBy: { display_order: 'asc' },
    });
  });

  it('findOne rejects missing or cross-tenant group as not found', async () => {
    const prisma = makePrisma();
    prisma.modifier_groups.findFirst.mockResolvedValueOnce(null as never);
    const service = new ModifierGroupsService(prisma as never);

    await expect(service.findOne(otherTenantUser, groupId)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.modifier_groups.findFirst).toHaveBeenCalledWith({
      where: { id: groupId, tenant_id: otherTenantUser.tenant_id },
      include: { options: { orderBy: { display_order: 'asc' } } },
    });
  });

  it('create scopes tenant from auth context and maps Prisma group uniqueness to ConflictException', async () => {
    const prisma = makePrisma();
    prisma.modifier_groups.create.mockRejectedValueOnce(
      prismaUnique({ target: 'uq_modifier_groups_tenant_name' }) as never,
    );
    const service = new ModifierGroupsService(prisma as never);

    await expect(service.create(user, { name: 'Temperature' })).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.modifier_groups.create).toHaveBeenCalledWith({
      data: {
        tenant_id: user.tenant_id,
        name: 'Temperature',
        is_active: true,
        display_order: 0,
      },
      include: { options: true },
    });
  });

  it('update verifies tenant ownership before composite-tenant update and maps field-based uniqueness', async () => {
    const prisma = makePrisma();
    prisma.modifier_groups.findFirst.mockResolvedValueOnce({ id: groupId } as never);
    prisma.modifier_groups.update.mockRejectedValueOnce(
      prismaUnique({ target: ['tenant_id', 'name'] }) as never,
    );
    const service = new ModifierGroupsService(prisma as never);

    await expect(
      service.update(user, groupId, { name: 'Sweetness' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.modifier_groups.findFirst).toHaveBeenCalledWith({
      where: { id: groupId, tenant_id: user.tenant_id },
      select: { id: true },
    });
    expect(prisma.modifier_groups.update).toHaveBeenCalledWith({
      where: { id_tenant_id: { id: groupId, tenant_id: user.tenant_id } },
      data: { name: 'Sweetness' },
      include: { options: true },
    });
  });

  it('update rejects cross-tenant group before write', async () => {
    const prisma = makePrisma();
    prisma.modifier_groups.findFirst.mockResolvedValueOnce(null as never);
    const service = new ModifierGroupsService(prisma as never);

    await expect(
      service.update(otherTenantUser, groupId, { is_active: false }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.modifier_groups.update).not.toHaveBeenCalled();
  });

  it('createOption verifies group tenant ownership and maps adapter constraint uniqueness', async () => {
    const prisma = makePrisma();
    prisma.modifier_groups.findFirst.mockResolvedValueOnce({ id: groupId } as never);
    prisma.modifier_options.create.mockRejectedValueOnce(
      prismaUnique({
        driverAdapterError: {
          cause: {
            constraint: { index: 'uq_modifier_options_tenant_group_name' },
          },
        },
      }) as never,
    );
    const service = new ModifierGroupsService(prisma as never);

    await expect(
      service.createOption(user, groupId, { name: 'Hot', price_delta: 0 }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.modifier_groups.findFirst).toHaveBeenCalledWith({
      where: { id: groupId, tenant_id: user.tenant_id },
      select: { id: true },
    });
    expect(prisma.modifier_options.create).toHaveBeenCalledWith({
      data: {
        tenant_id: user.tenant_id,
        modifier_group_id: groupId,
        name: 'Hot',
        price_delta: 0,
        is_active: true,
        display_order: 0,
      },
    });
  });

  it('createOption rejects option creation for group outside tenant', async () => {
    const prisma = makePrisma();
    prisma.modifier_groups.findFirst.mockResolvedValueOnce(null as never);
    const service = new ModifierGroupsService(prisma as never);

    await expect(
      service.createOption(otherTenantUser, groupId, {
        name: 'Ice',
        price_delta: 0,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.modifier_options.create).not.toHaveBeenCalled();
  });

  it('updateOption scopes lookup by option, group, tenant and maps option uniqueness', async () => {
    const prisma = makePrisma();
    prisma.modifier_options.findFirst.mockResolvedValueOnce({ id: optionId } as never);
    prisma.modifier_options.update.mockRejectedValueOnce(
      prismaUnique({ target: ['tenant_id', 'modifier_group_id', 'name'] }) as never,
    );
    const service = new ModifierGroupsService(prisma as never);

    await expect(
      service.updateOption(user, groupId, optionId, { name: 'Hot' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.modifier_options.findFirst).toHaveBeenCalledWith({
      where: {
        id: optionId,
        modifier_group_id: groupId,
        tenant_id: user.tenant_id,
      },
      select: { id: true },
    });
    expect(prisma.modifier_options.update).toHaveBeenCalledWith({
      where: { id: optionId },
      data: { name: 'Hot' },
    });
  });

  it('updateOption rejects cross-tenant option before write', async () => {
    const prisma = makePrisma();
    prisma.modifier_options.findFirst.mockResolvedValueOnce(null as never);
    const service = new ModifierGroupsService(prisma as never);

    await expect(
      service.updateOption(otherTenantUser, groupId, optionId, {
        price_delta: 500,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.modifier_options.update).not.toHaveBeenCalled();
  });
});

describe('Modifier group DTO validation', () => {
  it.each([
    [CreateModifierGroupDto, { name: 'Size', is_active: null }],
    [CreateModifierGroupDto, { name: 'Size', display_order: null }],
    [UpdateModifierGroupDto, { name: null }],
    [UpdateModifierGroupDto, { is_active: null }],
    [UpdateModifierGroupDto, { display_order: null }],
    [CreateModifierOptionDto, { name: 'Hot', price_delta: 0, is_active: null }],
    [UpdateModifierOptionDto, { name: null }],
    [UpdateModifierOptionDto, { display_order: null }],
  ])('rejects explicit null for non-nullable fields in %p: %p', async (Dto, body) => {
    const errors = await validate(Object.assign(new Dto(), body));
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each([CreateModifierGroupDto, CreateModifierOptionDto])('rejects blank names in %p', async (Dto) => {
    const errors = await validate(Object.assign(new Dto(), { name: '   ', price_delta: 0 }));
    expect(errors.some(error => error.property === 'name')).toBe(true);
  });

  it('rejects negative and fractional display order for groups and options', async () => {
    await expect(
      validate(plainToInstance(CreateModifierGroupDto, { name: 'Size', display_order: -1 })),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(UpdateModifierGroupDto, { display_order: 1.5 })),
    ).resolves.toHaveLength(1);
    await expect(
      validate(
        plainToInstance(CreateModifierOptionDto, {
          name: 'Hot',
          price_delta: 0,
          display_order: -1,
        }),
      ),
    ).resolves.toHaveLength(1);
  });

  it('rejects negative, fractional, and null option prices', async () => {
    await expect(
      validate(plainToInstance(CreateModifierOptionDto, { name: 'Hot', price_delta: -1 })),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(CreateModifierOptionDto, { name: 'Hot', price_delta: 1.5 })),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(CreateModifierOptionDto, { name: 'Hot', price_delta: null })),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(UpdateModifierOptionDto, { price_delta: null })),
    ).resolves.toHaveLength(1);
  });

  it('strips unknown tenant fields instead of accepting client-supplied tenant ownership', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    const result = await pipe.transform(
      { name: 'Size', tenant_id: otherTenantUser.tenant_id },
      { type: 'body', metatype: CreateModifierGroupDto },
    );

    expect(result).toEqual({ name: 'Size' });
    expect(result).not.toHaveProperty('tenant_id');
  });
});

describe('ModifierGroupsController RBAC metadata', () => {
  const reflector = new Reflector();

  it('applies JWT and roles guards at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ModifierGroupsController);

    expect(guards).toEqual([JwtGuard, RolesGuard]);
  });

  it('allows reads for any authenticated role and restricts writes to OWNER or ADMIN', () => {
    expect(reflector.get(ROLES_KEY, ModifierGroupsController.prototype.findAll)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, ModifierGroupsController.prototype.findOne)).toBeUndefined();

    for (const handler of [
      ModifierGroupsController.prototype.create,
      ModifierGroupsController.prototype.update,
      ModifierGroupsController.prototype.createOption,
      ModifierGroupsController.prototype.updateOption,
    ]) {
      expect(reflector.get(ROLES_KEY, handler)).toEqual(['OWNER', 'ADMIN']);
    }
  });
});
