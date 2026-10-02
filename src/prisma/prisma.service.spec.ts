import { createPrismaPgPoolConfig, PRISMA_PG_POOL_MAX } from './prisma.service';

describe('PrismaService pool configuration', () => {
  it('limits PostgreSQL pool size for small production deployments', () => {
    const connectionString = 'postgresql://user:password@postgres:5432/app?schema=public';

    expect(createPrismaPgPoolConfig(connectionString)).toEqual({
      connectionString,
      max: PRISMA_PG_POOL_MAX,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    expect(PRISMA_PG_POOL_MAX).toBe(5);
  });
});
