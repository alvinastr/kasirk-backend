import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductionBootstrapService } from './production-bootstrap.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

describe('ProductionBootstrapService', () => {
  let service: ProductionBootstrapService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionBootstrapService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            tenants: { count: jest.fn() },
            users: { count: jest.fn() },
            outlets: { count: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<ProductionBootstrapService>(ProductionBootstrapService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('validateInputs', () => {
    it('rejects invalid store code format', async () => {
      const inputs = {
        storeCode: 'ab',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '123456',
      };

      await expect(service.bootstrap(inputs)).rejects.toThrow(
        'Store code must match ^[A-Z0-9-]{3,32}$',
      );
    });

    it('rejects PIN not exactly 6 digits', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '12345',
      };

      await expect(service.bootstrap(inputs)).rejects.toThrow(
        'PIN must be exactly 6 digits',
      );
    });

    it('rejects empty tenant name', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: '',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '123456',
      };

      await expect(service.bootstrap(inputs)).rejects.toThrow(
        'Tenant name is required',
      );
    });

    it('rejects empty owner password', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: '',
        ownerPin: '123456',
      };

      await expect(service.bootstrap(inputs)).rejects.toThrow(
        'Owner password is required',
      );
    });

    it('rejects invalid email format', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'not-an-email',
        ownerPassword: 'password123',
        ownerPin: '123456',
      };

      await expect(service.bootstrap(inputs)).rejects.toThrow(
        'Valid email is required',
      );
    });
  });

  describe('bootstrap', () => {
    it('refuses when tenants already exist', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '123456',
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          tenants: { count: jest.fn().mockResolvedValue(1) },
          users: { count: jest.fn() },
          outlets: { count: jest.fn() },
        });
      });

      await expect(service.bootstrap(inputs)).rejects.toThrow(
        'Production bootstrap refused: business data already exists',
      );
    });

    it('refuses when users already exist', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '123456',
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          tenants: { count: jest.fn().mockResolvedValue(0) },
          users: { count: jest.fn().mockResolvedValue(1) },
          outlets: { count: jest.fn() },
        });
      });

      await expect(service.bootstrap(inputs)).rejects.toThrow(
        'Production bootstrap refused: business data already exists',
      );
    });

    it('refuses when outlets already exist', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '123456',
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          tenants: { count: jest.fn().mockResolvedValue(0) },
          users: { count: jest.fn().mockResolvedValue(0) },
          outlets: { count: jest.fn().mockResolvedValue(1) },
        });
      });

      await expect(service.bootstrap(inputs)).rejects.toThrow(
        'Production bootstrap refused: business data already exists',
      );
    });

    it('creates tenant, outlet, and OWNER with correct fields in empty database', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '123456',
      };

      const mockTenant = { id: 'tenant-id-123', store_code: 'STORE-001' };
      const mockOutlet = { id: 'outlet-id-456' };
      const mockOwner = {
        id: 'owner-id-789',
        email: 'admin@example.com',
        password_hash: 'hashed-password',
        pin_hash: 'hashed-pin',
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          tenants: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue(mockTenant),
          },
          users: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue(mockOwner),
          },
          outlets: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue(mockOutlet),
          },
        });
      });

      const result = await service.bootstrap(inputs);

      expect(result.tenantId).toBe('tenant-id-123');
      expect(result.storeCode).toBe('STORE-001');
      expect(result.outletId).toBe('outlet-id-456');
      expect(result.ownerId).toBe('owner-id-789');
      expect(result.ownerEmail).toBe('admin@example.com');
    });

    it('hashes password with bcrypt cost 10', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'testpassword',
        ownerPin: '123456',
      };

      let capturedPasswordHash: string | undefined;

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          tenants: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: 'tenant-id', store_code: 'STORE-001' }),
          },
          users: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockImplementation((args) => {
              capturedPasswordHash = args.data.password_hash;
              return Promise.resolve({
                id: 'owner-id',
                email: 'admin@example.com',
                password_hash: capturedPasswordHash,
                pin_hash: 'pin-hash',
              });
            }),
          },
          outlets: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: 'outlet-id' }),
          },
        });
      });

      await service.bootstrap(inputs);

      expect(capturedPasswordHash).toBeDefined();
      const isValid = await bcrypt.compare('testpassword', capturedPasswordHash!);
      expect(isValid).toBe(true);
    });

    it('hashes PIN with bcrypt cost 10', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '654321',
      };

      let capturedPinHash: string | undefined;

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          tenants: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: 'tenant-id', store_code: 'STORE-001' }),
          },
          users: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockImplementation((args) => {
              capturedPinHash = args.data.pin_hash;
              return Promise.resolve({
                id: 'owner-id',
                email: 'admin@example.com',
                password_hash: 'password-hash',
                pin_hash: capturedPinHash,
              });
            }),
          },
          outlets: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: 'outlet-id' }),
          },
        });
      });

      await service.bootstrap(inputs);

      expect(capturedPinHash).toBeDefined();
      const isValid = await bcrypt.compare('654321', capturedPinHash!);
      expect(isValid).toBe(true);
    });

    it('creates OWNER with outlet_id null', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '123456',
      };

      let capturedUserData: any;

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          tenants: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: 'tenant-id', store_code: 'STORE-001' }),
          },
          users: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockImplementation((args) => {
              capturedUserData = args.data;
              return Promise.resolve({
                id: 'owner-id',
                email: 'admin@example.com',
                password_hash: 'password-hash',
                pin_hash: 'pin-hash',
              });
            }),
          },
          outlets: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: 'outlet-id' }),
          },
        });
      });

      await service.bootstrap(inputs);

      expect(capturedUserData.outlet_id).toBeNull();
      expect(capturedUserData.role).toBe('OWNER');
      expect(capturedUserData.pin_failed_attempts).toBe(0);
      expect(capturedUserData.locked_until).toBeNull();
      expect(capturedUserData.is_active).toBe(true);
    });

    it('does not expose secrets in result', async () => {
      const inputs = {
        storeCode: 'STORE-001',
        tenantName: 'Test Tenant',
        outletName: 'Main Outlet',
        ownerName: 'Admin User',
        ownerEmail: 'admin@example.com',
        ownerPassword: 'password123',
        ownerPin: '123456',
      };

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          tenants: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: 'tenant-id', store_code: 'STORE-001' }),
          },
          users: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({
              id: 'owner-id',
              email: 'admin@example.com',
              password_hash: 'hashed-password',
              pin_hash: 'hashed-pin',
            }),
          },
          outlets: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: 'outlet-id' }),
          },
        });
      });

      const result = await service.bootstrap(inputs);

      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('pin');
      expect(result).not.toHaveProperty('password_hash');
      expect(result).not.toHaveProperty('pin_hash');
    });
  });
});
