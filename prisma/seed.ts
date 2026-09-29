import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
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
    storeCode: 'KK-DEMO',
    obsoleteStoreCode: 'KASIRKITA-DEMO',
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
    legacyEmail: 'owner@kasirkita.com',
    password: 'DemoOwner#2026',
    pin: '135790',
    loginCode: 'OWNER-DEMO',
  },
  cashier: {
    id: '10000000-0000-4000-8000-000000000004',
    name: 'Demo Cashier',
    email: 'cashier@kasirkita.demo',
    legacyEmail: 'cashier@kasirkita.com',
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

type SeedTransaction = Prisma.TransactionClient;
type DemoUser = typeof demo.owner | typeof demo.cashier;

async function deleteDemoTenant(tx: SeedTransaction, tenantId: string) {
  const [outlets, products] = await Promise.all([
    tx.outlets.findMany({
      where: { tenant_id: tenantId },
      select: { id: true },
    }),
    tx.products.findMany({
      where: { tenant_id: tenantId },
      select: { id: true },
    }),
  ]);
  const outletIds = outlets.map(({ id }) => id);
  const productIds = products.map(({ id }) => id);

  await tx.auth_audit_logs.deleteMany({ where: { tenant_id: tenantId } });
  await tx.device_sessions.deleteMany({ where: { tenant_id: tenantId } });
  await tx.payments.deleteMany({ where: { tenant_id: tenantId } });
  await tx.transaction_items.deleteMany({ where: { tenant_id: tenantId } });
  await tx.transactions.deleteMany({ where: { tenant_id: tenantId } });
  await tx.cashier_sessions.deleteMany({ where: { tenant_id: tenantId } });
  await tx.stock_adjustments.deleteMany({ where: { tenant_id: tenantId } });
  await tx.stock_movements.deleteMany({ where: { tenant_id: tenantId } });
  await tx.product_stocks.deleteMany({
    where: {
      OR: [
        { outlet_id: { in: outletIds } },
        { product_id: { in: productIds } },
      ],
    },
  });
  await tx.users.deleteMany({ where: { tenant_id: tenantId } });
  await tx.products.deleteMany({ where: { tenant_id: tenantId } });
  await tx.categories.deleteMany({ where: { tenant_id: tenantId } });
  await tx.customers.deleteMany({ where: { tenant_id: tenantId } });
  await tx.outlets.deleteMany({ where: { tenant_id: tenantId } });
  await tx.tenants.delete({ where: { id: tenantId } });
}

async function ensureDemoTenant(tx: SeedTransaction) {
  const canonicalTenant = await tx.tenants.findUnique({
    where: { store_code: demo.tenant.storeCode },
  });
  const obsoleteTenant = await tx.tenants.findUnique({
    where: { store_code: demo.tenant.obsoleteStoreCode },
  });

  let tenant = canonicalTenant;
  if (!tenant && obsoleteTenant) {
    tenant = await tx.tenants.update({
      where: { id: obsoleteTenant.id },
      data: { store_code: demo.tenant.storeCode },
    });
  }

  if (!tenant) {
    tenant = await tx.tenants.create({
      data: {
        id: demo.tenant.id,
        store_code: demo.tenant.storeCode,
        name: demo.tenant.name,
        address: demo.tenant.address,
        tax_enabled: false,
        tax_included: false,
        tax_rate: 0,
        is_active: true,
      },
    });
  }

  if (obsoleteTenant && obsoleteTenant.id !== tenant.id) {
    await deleteDemoTenant(tx, obsoleteTenant.id);
  }

  return tx.tenants.update({
    where: { id: tenant.id },
    data: {
      store_code: demo.tenant.storeCode,
      name: demo.tenant.name,
      address: demo.tenant.address,
      tax_enabled: false,
      tax_included: false,
      tax_rate: 0,
      is_active: true,
    },
    select: { id: true, store_code: true, name: true },
  });
}

async function ensureDemoOutlet(tx: SeedTransaction, tenantId: string) {
  const existingCashier = await tx.users.findFirst({
    where: {
      tenant_id: tenantId,
      role: 'CASHIER',
      email: { in: [demo.cashier.email, demo.cashier.legacyEmail] },
    },
    select: { outlet_id: true },
  });

  const cashierOutlet = existingCashier?.outlet_id
    ? await tx.outlets.findFirst({
        where: { id: existingCashier.outlet_id, tenant_id: tenantId },
      })
    : null;
  const outlet =
    cashierOutlet ??
    (await tx.outlets.findFirst({
      where: {
        tenant_id: tenantId,
        OR: [
          { id: demo.outlet.id },
          { name: { in: [demo.outlet.name, 'Toko Utama'] } },
        ],
      },
      orderBy: { created_at: 'asc' },
    }));

  if (!outlet) {
    return tx.outlets.create({
      data: {
        id: demo.outlet.id,
        tenant_id: tenantId,
        name: demo.outlet.name,
        address: demo.outlet.address,
        is_active: true,
      },
      select: { id: true, name: true },
    });
  }

  return tx.outlets.update({
    where: { id: outlet.id },
    data: {
      name: demo.outlet.name,
      address: demo.outlet.address,
      is_active: true,
    },
    select: { id: true, name: true },
  });
}

async function ensureDemoUser(
  tx: SeedTransaction,
  tenantId: string,
  outletId: string,
  user: DemoUser,
  passwordHash: string,
  pinHash: string,
) {
  const candidates = await tx.users.findMany({
    where: {
      tenant_id: tenantId,
      role: user === demo.owner ? 'OWNER' : 'CASHIER',
      OR: [
        { id: user.id },
        { email: { in: [user.email, user.legacyEmail] } },
        { login_code: user.loginCode },
      ],
    },
    select: { id: true, email: true },
  });
  const selected =
    candidates.find(({ email }) => email === user.email) ??
    candidates.find(({ email }) => email === user.legacyEmail) ??
    candidates[0];

  if (!selected) {
    return tx.users.create({
      data: {
        id: user.id,
        tenant_id: tenantId,
        outlet_id: user === demo.owner ? null : outletId,
        name: user.name,
        email: user.email,
        password_hash: passwordHash,
        pin_hash: pinHash,
        login_code: user.loginCode,
        pin_failed_attempts: 0,
        locked_until: null,
        pin_changed_at: demo.shift.openedAt,
        role: user === demo.owner ? 'OWNER' : 'CASHIER',
        is_active: true,
      },
    });
  }

  const candidateIds = candidates.map(({ id }) => id);
  const duplicateIds = candidateIds.filter((id) => id !== selected.id);
  const sessions = await tx.device_sessions.findMany({
    where: { tenant_id: tenantId, user_id: { in: candidateIds } },
    select: { id: true },
  });
  await tx.auth_audit_logs.deleteMany({
    where: {
      tenant_id: tenantId,
      OR: [
        { user_id: { in: candidateIds } },
        { session_id: { in: sessions.map(({ id }) => id) } },
      ],
    },
  });
  await tx.device_sessions.deleteMany({
    where: { tenant_id: tenantId, user_id: { in: candidateIds } },
  });
  await tx.cashier_sessions.deleteMany({
    where: {
      tenant_id: tenantId,
      user_id: { in: candidateIds },
      status: 'OPEN',
    },
  });

  if (duplicateIds.length > 0) {
    await tx.transactions.updateMany({
      where: { tenant_id: tenantId, user_id: { in: duplicateIds } },
      data: { user_id: selected.id },
    });
    await tx.stock_adjustments.updateMany({
      where: { tenant_id: tenantId, user_id: { in: duplicateIds } },
      data: { user_id: selected.id },
    });
    await tx.stock_movements.updateMany({
      where: { tenant_id: tenantId, user_id: { in: duplicateIds } },
      data: { user_id: selected.id },
    });
    await tx.cashier_sessions.updateMany({
      where: { tenant_id: tenantId, user_id: { in: duplicateIds } },
      data: { user_id: selected.id },
    });
    await tx.users.deleteMany({ where: { id: { in: duplicateIds } } });
  }

  return tx.users.update({
    where: { id: selected.id },
    data: {
      outlet_id: user === demo.owner ? null : outletId,
      name: user.name,
      email: user.email,
      password_hash: passwordHash,
      pin_hash: pinHash,
      login_code: user.loginCode,
      pin_failed_attempts: 0,
      locked_until: null,
      pin_changed_at: demo.shift.openedAt,
      role: user === demo.owner ? 'OWNER' : 'CASHIER',
      is_active: true,
    },
  });
}

async function validateDemoSeed() {
  const tenants = await prisma.tenants.findMany({
    where: {
      store_code: {
        in: [demo.tenant.storeCode, demo.tenant.obsoleteStoreCode],
      },
    },
    select: { id: true, store_code: true },
  });
  if (tenants.length !== 1 || tenants[0].store_code !== demo.tenant.storeCode) {
    throw new Error('Demo seed validation failed: expected one KK-DEMO tenant');
  }

  const tenantId = tenants[0].id;
  const users = await prisma.users.findMany({
    where: {
      OR: [
        { email: { in: [demo.owner.email, demo.cashier.email] } },
        {
          tenant_id: tenantId,
          email: { in: [demo.owner.legacyEmail, demo.cashier.legacyEmail] },
        },
      ],
    },
    select: { tenant_id: true, email: true, role: true, pin_hash: true },
  });
  const owner = users.filter(({ email }) => email === demo.owner.email);
  const cashier = users.filter(({ email }) => email === demo.cashier.email);
  const legacyEmails = new Set<string>([
    demo.owner.legacyEmail,
    demo.cashier.legacyEmail,
  ]);
  const legacyUsers = users.filter(({ email }) => legacyEmails.has(email));

  if (
    owner.length !== 1 ||
    owner[0].tenant_id !== tenantId ||
    owner[0].role !== 'OWNER' ||
    cashier.length !== 1 ||
    cashier[0].tenant_id !== tenantId ||
    cashier[0].role !== 'CASHIER' ||
    legacyUsers.length !== 0
  ) {
    throw new Error(
      'Demo seed validation failed: expected one OWNER and one CASHIER for KK-DEMO',
    );
  }

  const pinsValid = await Promise.all([
    bcrypt.compare(demo.owner.pin, owner[0].pin_hash ?? ''),
    bcrypt.compare(demo.cashier.pin, cashier[0].pin_hash ?? ''),
  ]);
  if (pinsValid.some((valid) => !valid)) {
    throw new Error('Demo seed validation failed: demo PIN mismatch');
  }

  return {
    tenantId,
    ownerEmail: owner[0].email,
    cashierEmail: cashier[0].email,
  };
}

async function seed() {
  const [ownerPasswordHash, ownerPinHash, cashierPasswordHash, cashierPinHash] =
    await Promise.all([
      bcrypt.hash(demo.owner.password, 10),
      bcrypt.hash(demo.owner.pin, 10),
      bcrypt.hash(demo.cashier.password, 10),
      bcrypt.hash(demo.cashier.pin, 10),
    ]);

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await ensureDemoTenant(tx);
    const outlet = await ensureDemoOutlet(tx, tenant.id);
    const owner = await ensureDemoUser(
      tx,
      tenant.id,
      outlet.id,
      demo.owner,
      ownerPasswordHash,
      ownerPinHash,
    );
    const cashier = await ensureDemoUser(
      tx,
      tenant.id,
      outlet.id,
      demo.cashier,
      cashierPasswordHash,
      cashierPinHash,
    );

    const categoryIds = new Map<string, string>();
    for (const category of demo.categories) {
      const seededCategory = await tx.categories.upsert({
        where: {
          tenant_id_name: {
            tenant_id: tenant.id,
            name: category.name,
          },
        },
        create: {
          id: category.id,
          tenant_id: tenant.id,
          name: category.name,
        },
        update: {},
        select: { id: true },
      });
      categoryIds.set(category.id, seededCategory.id);
    }

    for (const product of demo.products) {
      const seededProduct = await tx.products.upsert({
        where: {
          tenant_id_sku: {
            tenant_id: tenant.id,
            sku: product.sku,
          },
        },
        create: {
          id: product.id,
          tenant_id: tenant.id,
          category_id: categoryIds.get(product.categoryId),
          name: product.name,
          sku: product.sku,
          price: product.price,
          cost: product.cost,
          minimum_stock: product.minimumStock,
          track_stock: product.trackStock,
          is_active: true,
        },
        update: {
          category_id: categoryIds.get(product.categoryId),
          name: product.name,
          price: product.price,
          cost: product.cost,
          minimum_stock: product.minimumStock,
          track_stock: product.trackStock,
          is_active: true,
        },
        select: { id: true },
      });

      await tx.product_stocks.upsert({
        where: {
          outlet_id_product_id: {
            outlet_id: outlet.id,
            product_id: seededProduct.id,
          },
        },
        create: {
          outlet_id: outlet.id,
          product_id: seededProduct.id,
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
        user_id: cashier.id,
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
        user_id: cashier.id,
        opening_cash: demo.shift.openingCash,
        status: 'OPEN',
        opened_at: demo.shift.openedAt,
      },
      update: {
        tenant_id: tenant.id,
        outlet_id: outlet.id,
        user_id: cashier.id,
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

    return { tenant, outlet, owner, cashier, shift };
  });

  const validation = await validateDemoSeed();

  console.log('KasirKita demo seed completed');
  console.log(`Store: ${result.tenant.name} (${result.tenant.store_code})`);
  console.log(`Outlet: ${result.outlet.name} (${result.outlet.id})`);
  console.log(`Products: ${demo.products.length}`);
  console.log(
    `Cashier shift: ${result.shift.status} with opening cash Rp${result.shift.opening_cash}`,
  );
  console.log(
    `Validated tenant: ${validation.tenantId}; users: ${validation.ownerEmail}, ${validation.cashierEmail}`,
  );
  console.log(`Owner login: ${demo.owner.email} / PIN ${demo.owner.pin}`);
  console.log(`Cashier login: ${demo.cashier.email} / PIN ${demo.cashier.pin}`);
}

seed()
  .catch((error: unknown) => {
    console.error('KasirKita demo seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
