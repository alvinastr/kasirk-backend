import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { CategoriesController } from './categories.controller';
import type { CategoriesService } from './categories.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';

describe('CategoriesController', () => {
  let controller: CategoriesController;
  let service: {
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };

  const mockUser: JwtPayload = {
    sub: 'user-1',
    role: 'OWNER',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-1',
  };

  beforeEach(() => {
    service = {
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new CategoriesController(service as unknown as CategoriesService);
  });

  it('delegates findAll to service', async () => {
    (service.findAll as any).mockResolvedValue([{ id: 'c1' }]);
    const result = await controller.findAll(mockUser);
    expect(result).toEqual([{ id: 'c1' }]);
    expect(service.findAll).toHaveBeenCalledWith(mockUser);
  });

  it('delegates create to service', async () => {
    (service.create as any).mockResolvedValue({ id: 'c1', name: 'Drinks' });
    const result = await controller.create(mockUser, { name: 'Drinks' });
    expect(result).toEqual({ id: 'c1', name: 'Drinks' });
    expect(service.create).toHaveBeenCalledWith(mockUser, { name: 'Drinks' });
  });

  it('delegates update to service', async () => {
    (service.update as any).mockResolvedValue({ id: 'c1', name: 'Beverages' });
    const result = await controller.update(mockUser, 'c1', { name: 'Beverages' });
    expect(result).toEqual({ id: 'c1', name: 'Beverages' });
    expect(service.update).toHaveBeenCalledWith(mockUser, 'c1', { name: 'Beverages' });
  });

  it('delegates remove to service', async () => {
    (service.remove as any).mockResolvedValue({ id: 'c1' });
    const result = await controller.remove(mockUser, 'c1');
    expect(result).toEqual({ id: 'c1' });
    expect(service.remove).toHaveBeenCalledWith(mockUser, 'c1');
  });
});
