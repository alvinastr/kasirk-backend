import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CategoriesService } from './categories.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: any;

  const mockUser: JwtPayload = {
    sub: 'user-1',
    role: 'OWNER',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
  };

  beforeEach(() => {
    prisma = {
      categories: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      products: {
        count: jest.fn(),
      },
    };
    service = new CategoriesService(prisma as unknown as PrismaService);
  });

  describe('findAll', () => {
    it('returns categories for tenant ordered by name', async () => {
      const categories = [{ id: 'cat-1', name: 'Drinks' }];
      prisma.categories.findMany.mockResolvedValue(categories);

      const result = await service.findAll(mockUser);
      expect(result).toEqual(categories);
      expect(prisma.categories.findMany).toHaveBeenCalledWith({
        where: { tenant_id: mockUser.tenant_id },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('create', () => {
    it('creates category trimming whitespace', async () => {
      const created = { id: 'cat-1', name: 'Drinks', tenant_id: mockUser.tenant_id };
      prisma.categories.create.mockResolvedValue(created);

      const result = await service.create(mockUser, { name: '  Drinks  ' });
      expect(result).toEqual(created);
      expect(prisma.categories.create).toHaveBeenCalledWith({
        data: {
          tenant_id: mockUser.tenant_id,
          name: 'Drinks',
        },
      });
    });

    it('throws ConflictException on duplicate name', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.x',
        meta: { target: ['tenant_id', 'name'] },
      });
      prisma.categories.create.mockRejectedValue(error);

      await expect(service.create(mockUser, { name: 'Drinks' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('updates category name successfully', async () => {
      prisma.categories.findFirst.mockResolvedValue({ id: 'cat-1', tenant_id: mockUser.tenant_id });
      prisma.categories.update.mockResolvedValue({ id: 'cat-1', name: 'Beverages' });

      const result = await service.update(mockUser, 'cat-1', { name: 'Beverages' });
      expect(result.name).toBe('Beverages');
      expect(prisma.categories.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: { name: 'Beverages' },
      });
    });

    it('throws NotFoundException if category does not belong to tenant', async () => {
      prisma.categories.findFirst.mockResolvedValue(null);

      await expect(
        service.update(mockUser, 'non-existent', { name: 'Beverages' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('removes unused category', async () => {
      prisma.categories.findFirst.mockResolvedValue({ id: 'cat-1', tenant_id: mockUser.tenant_id });
      prisma.products.count.mockResolvedValue(0);
      prisma.categories.delete.mockResolvedValue({ id: 'cat-1' });

      const result = await service.remove(mockUser, 'cat-1');
      expect(result).toEqual({ id: 'cat-1' });
      expect(prisma.categories.delete).toHaveBeenCalledWith({ where: { id: 'cat-1' } });
    });

    it('throws ConflictException if category is in use by products', async () => {
      prisma.categories.findFirst.mockResolvedValue({ id: 'cat-1', tenant_id: mockUser.tenant_id });
      prisma.products.count.mockResolvedValue(3);

      await expect(service.remove(mockUser, 'cat-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
