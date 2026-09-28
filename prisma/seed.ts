import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed demo data');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const demo = {
  tenant: {
    id: '10000000-0000-4000-8000-000000000001',
    storeCode: 'KASIRKITA-DEMO',
    name: 'KasirKita Demo Store',
    address: 'Jl. Demo KasirKita No. 1, Jakarta',
  },
  outlet: {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Outlet Utama',
    address: 'Jl. Demo KasirKita No. 1, Jakarta',
  },
  owner: {
    id: '10000000-0000-4000-8000-000000000003',
    name: 'Demo Owner',
    email: 'owner@kasirkita.demo',
    password: 'DemoOwner#2026',
    pin: '135790',
    loginCode: 'OWNER-DEMO',
  },
  cashier: {
    id: '10000000-0000-4000-8000-000000000004',
    name: 'Demo Cashier',
    email: 'cashier@kasirkita.demo',
    password: 'DemoCashier#2026',
    pin: '246802',
    loginCode: 'CASHIER-DEMO',
  },
  categories: [
    {
      id: '10000000-0000-4000-8000-000000000101',
      name: 'Minuman',
    },
    {
      id: '10000000-0000-4000-8000-000000000102',
      name: 'Makanan',
    },
    {
      id: '10000000-0000-4000-8000-000000000103',
      name: 'Lainnya',
    },
  ],
  products: [
    {
      id: '10000000-0000-4000-8000-000000000201',
      categoryId: '10000000-0000-4000-8000-000000000101',
      name: 'Kopi Susu',
      sku: 'DEMO-MIN-001',
      price: 18_000,
      cost: 9_000,
      minimumStock: 10,
      trackStock: true,
      stock: 100,
    },
    {
      id: '10000000-0000-4000-8000-000000000202',
      categoryId: '10000000-0000-4000-8000-000000000101',
      name: 'Es Teh Manis',
      sku: 'DEMO-MIN-002',
      price: 8_000,
      cost: 2_500,
      minimumStock: 10,
      trackStock: true,
      stock: 100,
    },
    {
      id: '10000000-0000-4000-8000-000000000203',
      categoryId: '10000000-0000-4000-8000-000000000102',
      name: 'Nasi Goreng',
      sku: 'DEMO-MAK-001',
      price: 25_000,
      cost: 14_000,
      minimumStock: 5,
      trackStock: true,
      stock: 50,
    },
    {
      id: '10000000-0000-4000-8000-000000000204',
      categoryId: '10000000-0000-4000-8000-000000000102',
      name: 'Roti Bakar',
      sku: 'DEMO-MAK-002',
      price: 15_000,
      cost: 7_000,
      minimumStock: 5,
      trackStock: true,
      stock: 40,
    },
    {
      id: '10000000-0000-4000-8000-000000000205',
      categoryId: '10000000-0000-4000-8000-000000000103',
      name: 'Biaya Layanan',
      sku: 'DEMO-LAI-001',
      price: 2_000,
      cost: 0,
      minimumStock: 0,
      trackStock: false,
      stock: 0,
    },
  ],
  shift: {
    id: '10000000-0000-4000-8000-000000000301',
    openingCash: 500_000n,
    openedAt: new Date('2026-01-01T08:00:00.000Z'),
  },
} as const;

async function seed() {
  const [ownerPasswordHash, ownerPinHash, cashierPasswordHash, cashierPinHash] =
    await Promise.all([
      bcrypt.hash(demo.owner.password, 10),
      bcrypt.hash(demo.owner.pin, 10),
      bcrypt.hash(demo.cashier.password, 10),
      bcrypt.hash(demo.cashier.pin, 10),
    ]);

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenants.upsert({
      where: { store_code: demo.tenant.storeCode },
      create: {
        id: demo.tenant.id,
        store_code: demo.tenant.storeCode,
        name: demo.tenant.name,
        address: demo.tenant.address,
        tax_enabled: false,
        tax_included: false,
        tax_rate: 0,
        is_active: true,
      },
      update: {
        name: demo.tenant.name,
        address: demo.tenant.address,
        tax_enabled: false,
        tax_included: false,
        tax_rate: 0,
        is_active: true,
      },
      select: { id: true, store_code: true, name: true },
    });

    const outlet = await tx.outlets.upsert({
      where: { id: demo.outlet.id },
      create: {
        id: demo.outlet.id,
        tenant_id: tenant.id,
        name: demo.outlet.name,
        address: demo.outlet.address,
        is_active: true,
      },
      update: {
        tenant_id: tenant.id,
        name: demo.outlet.name,
        address: demo.outlet.address,
        is_active: true,
      },
      select: { id: true, name: true },
    });

    await tx.users.upsert({
      where: { id: demo.owner.id },
      create: {
        id: demo.owner.id,
        tenant_id: tenant.id,
        outlet_id: null,
        name: demo.owner.name,
        email: demo.owner.email,
        password_hash: ownerPasswordHash,
        pin_hash: ownerPinHash,
        login_code: demo.owner.loginCode,
        pin_failed_attempts: 0,
        locked_until: null,
        pin_changed_at: demo.shift.openedAt,
        role: 'OWNER',
        is_active: true,
      },
      update: {
        tenant_id: tenant.id,
        outlet_id: null,
        name: demo.owner.name,
        email: demo.owner.email,
        password_hash: ownerPasswordHash,
        pin_hash: ownerPinHash,
        login_code: demo.owner.loginCode,
        pin_failed_attempts: 0,
        locked_until: null,
        pin_changed_at: demo.shift.openedAt,
        role: 'OWNER',
        is_active: true,
      },
    });

    await tx.users.upsert({
      where: { id: demo.cashier.id },
      create: {
        id: demo.cashier.id,
        tenant_id: tenant.id,
        outlet_id: outlet.id,
        name: demo.cashier.name,
        email: demo.cashier.email,
        password_hash: cashierPasswordHash,
        pin_hash: cashierPinHash,
        login_code: demo.cashier.loginCode,
        pin_failed_attempts: 0,
        locked_until: null,
        pin_changed_at: demo.shift.openedAt,
        role: 'CASHIER',
        is_active: true,
      },
      update: {
        tenant_id: tenant.id,
        outlet_id: outlet.id,
        name: demo.cashier.name,
        email: demo.cashier.email,
        password_hash: cashierPasswordHash,
        pin_hash: cashierPinHash,
        login_code: demo.cashier.loginCode,
        pin_failed_attempts: 0,
        locked_until: null,
        pin_changed_at: demo.shift.openedAt,
        role: 'CASHIER',
        is_active: true,
      },
    });

    for (const category of demo.categories) {
      await tx.categories.upsert({
        where: { id: category.id },
        create: {
          id: category.id,
          tenant_id: tenant.id,
          name: category.name,
        },
        update: {
          tenant_id: tenant.id,
          name: category.name,
        },
      });
    }

    for (const product of demo.products) {
      await tx.products.upsert({
        where: { id: product.id },
        create: {
          id: product.id,
          tenant_id: tenant.id,
          category_id: product.categoryId,
          name: product.name,
          sku: product.sku,
          price: product.price,
          cost: product.cost,
          minimum_stock: product.minimumStock,
          track_stock: product.trackStock,
          is_active: true,
        },
        update: {
          tenant_id: tenant.id,
          category_id: product.categoryId,
          name: product.name,
          sku: product.sku,
          price: product.price,
          cost: product.cost,
          minimum_stock: product.minimumStock,
          track_stock: product.trackStock,
          is_active: true,
        },
      });

      await tx.product_stocks.upsert({
        where: {
          outlet_id_product_id: {
            outlet_id: outlet.id,
            product_id: product.id,
          },
        },
        create: {
          outlet_id: outlet.id,
          product_id: product.id,
          stock: product.stock,
        },
        update: {
          stock: product.stock,
          updated_at: demo.shift.openedAt,
        },
      });
    }

    await tx.cashier_sessions.deleteMany({
      where: {
        tenant_id: tenant.id,
        user_id: demo.cashier.id,
        status: 'OPEN',
        NOT: { id: demo.shift.id },
      },
    });

    const shift = await tx.cashier_sessions.upsert({
      where: { id: demo.shift.id },
      create: {
        id: demo.shift.id,
        tenant_id: tenant.id,
        outlet_id: outlet.id,
        user_id: demo.cashier.id,
        opening_cash: demo.shift.openingCash,
        status: 'OPEN',
        opened_at: demo.shift.openedAt,
      },
      update: {
        tenant_id: tenant.id,
        outlet_id: outlet.id,
        user_id: demo.cashier.id,
        opening_cash: demo.shift.openingCash,
        closing_cash: null,
        expected_cash: null,
        difference: null,
        status: 'OPEN',
        opened_at: demo.shift.openedAt,
        closed_at: null,
      },
      select: { id: true, status: true, opening_cash: true },
    });

    return { tenant, outlet, shift };
  });

  console.log('KasirKita demo seed completed');
  console.log(`Store: ${result.tenant.name} (${result.tenant.store_code})`);
  console.log(`Outlet: ${result.outlet.name} (${result.outlet.id})`);
  console.log(`Products: ${demo.products.length}`);
  console.log(
    `Cashier shift: ${result.shift.status} with opening cash Rp${result.shift.opening_cash}`,
  );
}

seed()
  .catch((error: unknown) => {
    console.error('KasirKita demo seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
