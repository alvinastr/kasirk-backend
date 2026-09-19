import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: JwtPayload) {
    return this.prisma.products.findMany({
      where: {
        tenant_id: user.tenant_id,
        is_active: true,
      },
    });
  }

  async create(user: JwtPayload, dto: CreateProductDto) {
    await this.validateCategory(user.tenant_id, dto.category_id);

    return this.prisma.products.create({
      data: {
        tenant_id: user.tenant_id,
        name: dto.name,
        sku: dto.sku,
        price: dto.price,
        cost: dto.cost,
        minimum_stock: dto.minimum_stock,
        category_id: dto.category_id ?? null,
        track_stock: dto.track_stock ?? true,
      },
    });
  }

  async update(user: JwtPayload, id: string, dto: UpdateProductDto) {
    const product = await this.prisma.products.findFirst({
      where: { id, tenant_id: user.tenant_id },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (dto.category_id !== undefined) {
      await this.validateCategory(user.tenant_id, dto.category_id);
    }

    const data = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
      ...(dto.price !== undefined ? { price: dto.price } : {}),
      ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
      ...(dto.minimum_stock !== undefined
        ? { minimum_stock: dto.minimum_stock }
        : {}),
      ...(dto.category_id !== undefined
        ? { category_id: dto.category_id }
        : {}),
      ...(dto.track_stock !== undefined
        ? { track_stock: dto.track_stock }
        : {}),
    };
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('At least one product field is required');
    }

    return this.prisma.products.update({
      where: { id_tenant_id: { id, tenant_id: user.tenant_id } },
      data,
    });
  }

  private async validateCategory(
    tenantId: string,
    categoryId: string | null | undefined,
  ): Promise<void> {
    if (categoryId == null) {
      return;
    }
    const category = await this.prisma.categories.findFirst({
      where: { id: categoryId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }
}
