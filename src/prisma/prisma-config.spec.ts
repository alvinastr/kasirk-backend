import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Prisma config', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    jest.resetModules();
  });

  it('reads datasource url from the runtime DATABASE_URL environment variable', async () => {
    const runtimeDatabaseUrl = 'postgresql://user:password@localhost:5432/kasirkita?schema=public';
    process.env.DATABASE_URL = runtimeDatabaseUrl;

    const { default: config } = await import('../../prisma.config');

    expect(config.datasource?.url).toBe(runtimeDatabaseUrl);
  });

  it('copies prisma.config.ts into the final runtime image', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain(
      'COPY --from=build /app/prisma.config.ts ./prisma.config.ts',
    );
  });
});
