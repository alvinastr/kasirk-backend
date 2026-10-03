import 'reflect-metadata';
import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, jest } from '@jest/globals';
import { ProductsService } from './products.service';
import { QueryProductsDto } from './dto/query-products.dto';

const tenantId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';
const outletId = '44444444-4444-4444-8444-444444444444';
const otherOutletId = '55555555-5555-4555-8555-555555555555';
const otherTenantId = '66666666-6666-4666-8666-666666666666';
const user = { sub: 'user-1', tenant_id: tenantId, role: 'CASHIER', outlet_id: outletId };

function makePrisma() {
  return {
    products: { findMany: jest.fn() },
    categories: { findFirst: jest.fn() },
  };
}

function stockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    outlet_id: outletId,
    product_id: '33333333-3333-4333-8333-333333333333',
    stock: 8,
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: tenantId,
    category_id: categoryId,
    name: 'Cafe Latte',
    sku: 'LATTE',
    price: 25000,
    cost: 10000,
    minimum_stock: 2,
    track_stock: true,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    categories: { id: categoryId, name: 'Coffee' },
    product_stocks: [stockRow()],
    product_modifier_groups: [],
    ...overrides,
  };
}

describe('ProductsService V1-M3 catalog query', () => {
  it('preserves active tenant catalog behavior and existing product fields without filters', async () => {
    const prisma = makePrisma();
    const row = product();
    prisma.products.findMany.mockResolvedValueOnce([row] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, {});

    expect(prisma.products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: tenantId, is_active: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(result[0]).toMatchObject({
      id: row.id,
      tenant_id: row.tenant_id,
      category_id: row.category_id,
      name: row.name,
      sku: row.sku,
      price: row.price,
      cost: row.cost,
      minimum_stock: row.minimum_stock,
      track_stock: row.track_stock,
      stock: 8,
      is_active: true,
      category: row.categories,
      modifier_groups: [],
    });
  });

  it('loads only current outlet stock for the authenticated tenant without N+1 queries', async () => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([
      product({
        product_stocks: [
          stockRow({ stock: 8 }),
          stockRow({ outlet_id: otherOutletId, stock: 99 }),
        ],
      }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, {});

    expect(prisma.products.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          product_stocks: {
            where: {
              outlet_id: outletId,
              outlets: { tenant_id: tenantId },
            },
            select: { stock: true },
          },
        }),
      }),
    );
    expect(result[0].stock).toBe(8);
  });

  it('does not expose another outlet or tenant stock when mapping catalog stock', async () => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([
      product({ product_stocks: [] }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, { include_modifiers: false });

    expect(result[0].stock).toBe(0);
  });

  it.each([
    ['tracked stock available', true, [stockRow({ stock: 5 })], 5],
    ['tracked stock empty', true, [stockRow({ stock: 0 })], 0],
    ['tracked stock row missing', true, [], 0],
    ['untracked stock remains null', false, [stockRow({ stock: 99 })], null],
  ])('maps %s for POS stock state', async (_case, track_stock, product_stocks, expectedStock) => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([
      product({ track_stock, product_stocks }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, { include_modifiers: false });

    expect(result[0]).toMatchObject({ track_stock, stock: expectedStock });
  });

  it.each([
    ['name', 'latte'],
    ['SKU', 'LAT'],
  ])('searches product %s case-insensitively inside tenant and active constraints', async (_field, q) => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([] as never);
    const service = new ProductsService(prisma as never);

    await service.findAll(user, { q });

    expect(prisma.products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: tenantId,
          is_active: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('treats empty q as no text filter and returns empty result when Prisma has no match', async () => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([] as never);
    const service = new ProductsService(prisma as never);

    await expect(service.findAll(user, { q: '' })).resolves.toEqual([]);
    expect(prisma.products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenant_id: tenantId, is_active: true } }),
    );
  });

  it('validates category ownership and composes category and q with AND semantics', async () => {
    const prisma = makePrisma();
    prisma.categories.findFirst.mockResolvedValueOnce({ id: categoryId } as never);
    prisma.products.findMany.mockResolvedValueOnce([] as never);
    const service = new ProductsService(prisma as never);

    await service.findAll(user, { category_id: categoryId, q: 'latte' });

    expect(prisma.categories.findFirst).toHaveBeenCalledWith({
      where: { id: categoryId, tenant_id: tenantId },
      select: { id: true },
    });
    expect(prisma.products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: tenantId,
          is_active: true,
          category_id: categoryId,
          OR: [
            { name: { contains: 'latte', mode: 'insensitive' } },
            { sku: { contains: 'latte', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('rejects nonexistent or foreign-tenant category before product query', async () => {
    const prisma = makePrisma();
    prisma.categories.findFirst.mockResolvedValueOnce(null as never);
    const service = new ProductsService(prisma as never);

    await expect(service.findAll(user, { category_id: categoryId })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.products.findMany).not.toHaveBeenCalled();
  });

  it('includes only active tenant-owned modifier groups and active options by default with stable ordering', async () => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([product()] as never);
    const service = new ProductsService(prisma as never);

    await service.findAll(user, {});

    expect(prisma.products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          categories: true,
          product_stocks: {
            where: {
              outlet_id: outletId,
              outlets: { tenant_id: tenantId },
            },
            select: { stock: true },
          },
          product_modifier_groups: {
            where: {
              tenant_id: tenantId,
              modifier_groups: { is_active: true },
            },
            include: {
              modifier_groups: {
                include: {
                  options: {
                    where: { tenant_id: tenantId, is_active: true },
                    orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
                  },
                },
              },
            },
            orderBy: [{ display_order: 'asc' }, { modifier_group_id: 'asc' }],
          },
        },
      }),
    );
  });

  it('does not load modifier relations when include_modifiers is false', async () => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([
      product({ product_modifier_groups: undefined }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, { include_modifiers: false });

    expect(prisma.products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          categories: true,
          product_stocks: {
            where: {
              outlet_id: outletId,
              outlets: { tenant_id: tenantId },
            },
            select: { stock: true },
          },
        },
      }),
    );
    expect(result[0].modifier_groups).toEqual([]);
  });

  it('keeps zero-stock tracked and untracked products represented without stock filtering', async () => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([
      product({ id: 'tracked-zero', track_stock: true, stock: 0 }),
      product({ id: 'untracked', track_stock: false, stock: 0 }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, { include_modifiers: false });

    expect(result.map((item) => item.id)).toEqual(['tracked-zero', 'untracked']);
    expect(prisma.products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: tenantId, is_active: true },
      }),
    );
  });

  it('returns stock null when user has no assigned outlet (nullable outlet_id)', async () => {
    const prisma = makePrisma();
    const noOutletUser = { ...user, outlet_id: null };
    prisma.products.findMany.mockResolvedValueOnce([
      product({ track_stock: true, product_stocks: [] }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(noOutletUser, { include_modifiers: false });

    expect(prisma.products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          product_stocks: false,
        }),
      }),
    );
    expect(result[0].stock).toBeNull();
  });

  it('returns stock with q search still working', async () => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([
      product({ product_stocks: [stockRow({ stock: 3 })] }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, { q: 'latte' });

    expect(result[0].stock).toBe(3);
  });

  it('returns stock with category_id filter still working', async () => {
    const prisma = makePrisma();
    prisma.categories.findFirst.mockResolvedValueOnce({ id: categoryId } as never);
    prisma.products.findMany.mockResolvedValueOnce([
      product({ product_stocks: [stockRow({ stock: 7 })] }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, { category_id: categoryId });

    expect(result[0].stock).toBe(7);
  });

  it('returns stock with include_modifiers=true and still loads modifier groups', async () => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([
      product({ product_stocks: [stockRow({ stock: 12 })] }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, { include_modifiers: true });

    expect(result[0].stock).toBe(12);
    expect(result[0].modifier_groups).toEqual([]);
  });

  it('returns stock with include_modifiers=false and does not load modifier relations', async () => {
    const prisma = makePrisma();
    prisma.products.findMany.mockResolvedValueOnce([
      product({ product_stocks: [stockRow({ stock: 9 })] }),
    ] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, { include_modifiers: false });

    expect(result[0].stock).toBe(9);
    expect(result[0].modifier_groups).toEqual([]);
  });

  it('preserves all existing product response fields alongside stock', async () => {
    const prisma = makePrisma();
    const row = product({ product_stocks: [stockRow({ stock: 4 })] });
    prisma.products.findMany.mockResolvedValueOnce([row] as never);
    const service = new ProductsService(prisma as never);

    const result = await service.findAll(user, { include_modifiers: false });

    expect(result[0]).toMatchObject({
      id: row.id,
      tenant_id: row.tenant_id,
      category_id: row.category_id,
      name: row.name,
      sku: row.sku,
      price: row.price,
      cost: row.cost,
      minimum_stock: row.minimum_stock,
      track_stock: row.track_stock,
      is_active: row.is_active,
      created_at: row.created_at,
      category: { id: categoryId, name: 'Coffee' },
      modifier_groups: [],
      stock: 4,
    });
  });
});

describe('QueryProductsDto V1-M3 validation', () => {
  it('trims q and explicitly parses true or false', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

    await expect(
      pipe.transform(
        { q: '  latte  ', include_modifiers: 'false' },
        { type: 'query', metatype: QueryProductsDto },
      ),
    ).resolves.toEqual({ q: 'latte', include_modifiers: false });
  });

  it.each([
    { category_id: 'not-a-uuid' },
    { include_modifiers: 'yes' },
    { include_modifiers: '0' },
  ])('rejects malformed query value %#', async (input) => {
    const dto = plainToInstance(QueryProductsDto, input);
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('rejects unknown query parameters', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    await expect(
      pipe.transform(
        { unsupported: 'value' },
        { type: 'query', metatype: QueryProductsDto },
      ),
    ).rejects.toThrow();
  });
});
