import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';

@Injectable()
export class StockService {
    constructor(private prisma: PrismaService) {}

    async findByOutlet(user: JwtPayload, outlet_id: string) {
        const outlet = await this.prisma.outlets.findFirst({
            where: { id: outlet_id, tenant_id: user.tenant_id },
            select: { id: true },
        });
        if (!outlet) {
            throw new NotFoundException('Outlet not found');
        }

        return this.prisma.product_stocks.findMany({
            where: {
                outlet_id,
                outlets: { tenant_id: user.tenant_id },
                products: { tenant_id: user.tenant_id },
            },
            include: { products: true },
        });
    }

    async createAdjustment(user: JwtPayload, dto: CreateStockAdjustmentDto) {
        return this.prisma.$transaction(async (tx) => {
            const outlet = await tx.outlets.findFirst({
                where: { id: dto.outlet_id, tenant_id: user.tenant_id },
                select: { id: true },
            });
            if (!outlet) {
                throw new NotFoundException('Outlet not found');
            }

            const product = await tx.products.findFirst({
                where: { id: dto.product_id, tenant_id: user.tenant_id },
                select: { id: true },
            });
            if (!product) {
                throw new NotFoundException('Product not found');
            }

            const actor = await tx.users.findFirst({
                where: { id: user.sub, tenant_id: user.tenant_id },
                select: { id: true },
            });
            if (!actor) {
                throw new NotFoundException('User not found');
            }

            const scope = {
                outlet_id: dto.outlet_id,
                product_id: dto.product_id,
                outlets: { tenant_id: user.tenant_id },
                products: { tenant_id: user.tenant_id },
            };
            const delta = dto.adjustment_type === 'DEDUCT' ? -dto.quantity : dto.quantity;

            if (dto.adjustment_type === 'ADD') {
                // The unique outlet/product key handles simultaneous first adjustments.
                await tx.product_stocks.createMany({
                    data: {
                        outlet_id: dto.outlet_id,
                        product_id: dto.product_id,
                        stock: 0,
                    },
                    skipDuplicates: true,
                });
            }

            // Check and decrement in the same statement so concurrent requests cannot oversell.
            const updated = await tx.product_stocks.updateMany({
                where: {
                    ...scope,
                    ...(dto.adjustment_type === 'DEDUCT' ? { stock: { gte: dto.quantity } } : {}),
                },
                data: { stock: { increment: delta }, updated_at: new Date() },
            });
            if (updated.count !== 1) {
                throw new ConflictException('Insufficient stock');
            }

            const adjustment = await tx.stock_adjustments.create({
                data: {
                    tenant_id: user.tenant_id,
                    outlet_id: dto.outlet_id,
                    product_id: dto.product_id,
                    user_id: user.sub,
                    type: dto.adjustment_type,
                    quantity: dto.quantity,
                    reason: dto.reason,
                },
            });

            await tx.stock_movements.create({
                data: {
                    tenant_id: user.tenant_id,
                    outlet_id: dto.outlet_id,
                    product_id: dto.product_id,
                    user_id: user.sub,
                    type: 'ADJUSTMENT',
                    quantity: delta,
                    reference_type: 'STOCK_ADJUSTMENT',
                    reference_id: adjustment.id,
                    reason: dto.reason,
                },
            });

            return tx.product_stocks.findFirstOrThrow({ where: scope });
        });
    }
}
