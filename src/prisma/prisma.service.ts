import {Injectable, OnModuleInit, OnModuleDestroy} from '@nestjs/common';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import type {PoolConfig} from 'pg';

export const PRISMA_PG_POOL_MAX = 5;

export function createPrismaPgPoolConfig(connectionString: string): PoolConfig {
    return {
        connectionString,
        max: PRISMA_PG_POOL_MAX,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
    };
}

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy
    {
        constructor() {
            const adapter = new PrismaPg(
                createPrismaPgPoolConfig(process.env.DATABASE_URL!),
            );
            super({ adapter });
        }

        async onModuleInit() {
            await this.$connect();
        }

        async onModuleDestroy() {
            await this.$disconnect();
        }
    }
