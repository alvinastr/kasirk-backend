import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { isUniqueConstraintViolation } from '../common/utils/prisma-error.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ReplaceProductModifierGroupsDto, ReplaceProductModifierGroupItemDto } from './dto/replace-product-modifier-groups.dto';
import { QueryProductsDto } from './dto/query-products.dto';

const MODIFIER_SELECTION_TYPES = ['SINGLE', 'MULTIPLE'] as const;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: JwtPayload, query?: QueryProductsDto) {
    const includeModifiers = query?.include_modifiers ?? true;

    if (query?.category_id) {
      await this.validateCategory(user.tenant_id, query.category_id);
    }

    const searchConditions: any[] = [];
    if (query?.q && query.q.length > 0) {
      searchConditions.push(
        { name: { contains: query.q, mode: 'insensitive' } },
        { sku: { contains: query.q, mode: 'insensitive' } },
      );
    }

    const where = {
      tenant_id: user.tenant_id,
      is_active: true,
      ...(query?.category_id ? { category_id: query.category_id } : {}),
      ...(searchConditions.length > 0 ? { OR: searchConditions } : {}),
    };
    const orderBy = [{ name: 'asc' as const }, { id: 'asc' as const }];

    if (!includeModifiers) {
      const products = await this.prisma.products.findMany({
        where,
        include: {
          categories: true,
          product_stocks: this.stockInclude(user),
        },
        orderBy,
      });
      return products.map(({ categories, product_stocks, ...fields }) => ({
        ...fields,
        category: categories
          ? { id: categories.id, name: categories.name }
          : null,
        modifier_groups: [],
        stock: this.resolveStock(fields.track_stock, product_stocks, user.outlet_id),
      }));
    }

    const products = await this.prisma.products.findMany({
      where,
      include: {
        categories: true,
        product_stocks: this.stockInclude(user),
        product_modifier_groups: {
          where: {
            tenant_id: user.tenant_id,
            modifier_groups: { is_active: true },
          },
          include: {
            modifier_groups: {
              include: {
                options: {
                  where: { tenant_id: user.tenant_id, is_active: true },
                  orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
                },
              },
            },
          },
          orderBy: [{ display_order: 'asc' }, { modifier_group_id: 'asc' }],
        },
      },
      orderBy,
    });

    return products.map(
      ({ categories, product_modifier_groups, product_stocks, ...fields }) => ({
        ...fields,
        category: categories
          ? { id: categories.id, name: categories.name }
          : null,
        modifier_groups: product_modifier_groups.map((assignment) => ({
          id: assignment.modifier_groups.id,
          name: assignment.modifier_groups.name,
          required: assignment.required,
          selection_type: assignment.selection_type,
          display_order: assignment.display_order,
          options: assignment.modifier_groups.options,
        })),
        stock: this.resolveStock(fields.track_stock, product_stocks, user.outlet_id),
      }),
    );
  }

  async create(user: JwtPayload, dto: CreateProductDto) {
    await this.validateCategory(user.tenant_id, dto.category_id);

    try {
      return await this.prisma.products.create({
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
    } catch (error) {
      this.rethrowProductWriteError(error);
    }
  }

  async update(user: JwtPayload, id: string, dto: UpdateProductDto) {
    const product = await this.prisma.products.findFirst({
      where: { id, tenant_id: user.tenant_id },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({
        error_code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      });
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

    try {
      return await this.prisma.products.update({
        where: { id_tenant_id: { id, tenant_id: user.tenant_id } },
        data,
      });
    } catch (error) {
      this.rethrowProductWriteError(error);
    }
  }

  async getModifierGroups(user: JwtPayload, productId: string) {
    await this.validateProductOwnership(user.tenant_id, productId);

    const assignments = await this.prisma.product_modifier_groups.findMany({
      where: {
        tenant_id: user.tenant_id,
        product_id: productId,
        modifier_groups: { is_active: true },
      },
      include: {
        modifier_groups: {
          include: {
            options: {
              where: { is_active: true },
              orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
      orderBy: [{ display_order: 'asc' }, { modifier_group_id: 'asc' }],
    });

    return {
      product_id: productId,
      modifier_groups: assignments.map((assignment) => ({
        id: assignment.modifier_groups.id,
        name: assignment.modifier_groups.name,
        required: assignment.required,
        selection_type: assignment.selection_type,
        display_order: assignment.display_order,
        options: assignment.modifier_groups.options,
      })),
    };
  }

  async replaceModifierGroups(
    user: JwtPayload,
    productId: string,
    dto: ReplaceProductModifierGroupsDto,
  ) {
    await this.validateProductOwnership(user.tenant_id, productId);

    const seen = new Set<string>();
    for (const assignment of dto.modifier_groups) {
      if (seen.has(assignment.modifier_group_id)) {
        throw new ConflictException({
          error_code: 'DUPLICATE_MODIFIER_GROUP_ASSIGNMENT',
          message: 'Duplicate modifier group assignment',
        });
      }
      seen.add(assignment.modifier_group_id);

      if (!MODIFIER_SELECTION_TYPES.includes(assignment.selection_type)) {
        throw new BadRequestException({
          error_code: 'INVALID_MODIFIER_SELECTION_TYPE',
          message: 'selection_type must be SINGLE or MULTIPLE',
        });
      }
      if (assignment.required && assignment.selection_type === 'MULTIPLE') {
        throw new BadRequestException({
          error_code: 'REQUIRED_MULTIPLE_NOT_SUPPORTED',
          message: 'Required MULTIPLE modifier groups are not supported in V1',
        });
      }
    }

    const groupIds = dto.modifier_groups.map(
      (assignment) => assignment.modifier_group_id,
    );
    if (groupIds.length > 0) {
      const ownedActiveGroups = await this.prisma.modifier_groups.findMany({
        where: {
          tenant_id: user.tenant_id,
          id: { in: groupIds },
          is_active: true,
        },
        select: { id: true },
      });
      if (ownedActiveGroups.length !== groupIds.length) {
        throw new NotFoundException({
          error_code: 'MODIFIER_GROUP_NOT_FOUND',
          message: 'One or more active modifier groups were not found',
        });
      }
    }

    const deleteOperation = this.prisma.product_modifier_groups.deleteMany({
      where: { tenant_id: user.tenant_id, product_id: productId },
    });
    const operations = [deleteOperation];
    if (dto.modifier_groups.length > 0) {
      operations.push(
        this.prisma.product_modifier_groups.createMany({
          data: dto.modifier_groups.map((assignment) => ({
            tenant_id: user.tenant_id,
            product_id: productId,
            modifier_group_id: assignment.modifier_group_id,
            required: assignment.required,
            selection_type: assignment.selection_type,
            display_order: assignment.display_order,
          })),
        }),
      );
    }
    await this.prisma.$transaction(operations);

    return this.getModifierGroups(user, productId);
  }

  async assignModifierGroup(
    user: JwtPayload,
    productId: string,
    dto: ReplaceProductModifierGroupItemDto,
  ) {
    await this.validateProductOwnership(user.tenant_id, productId);

    if (!MODIFIER_SELECTION_TYPES.includes(dto.selection_type)) {
      throw new BadRequestException({
        error_code: 'INVALID_MODIFIER_SELECTION_TYPE',
        message: 'selection_type must be SINGLE or MULTIPLE',
      });
    }
    if (dto.required && dto.selection_type === 'MULTIPLE') {
      throw new BadRequestException({
        error_code: 'REQUIRED_MULTIPLE_NOT_SUPPORTED',
        message: 'Required MULTIPLE modifier groups are not supported in V1',
      });
    }

    const group = await this.prisma.modifier_groups.findFirst({
      where: {
        tenant_id: user.tenant_id,
        id: dto.modifier_group_id,
        is_active: true,
      },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException({
        error_code: 'MODIFIER_GROUP_NOT_FOUND',
        message: 'Active modifier group not found',
      });
    }

    try {
      return await this.prisma.product_modifier_groups.create({
        data: {
          tenant_id: user.tenant_id,
          product_id: productId,
          modifier_group_id: dto.modifier_group_id,
          required: dto.required,
          selection_type: dto.selection_type,
          display_order: dto.display_order,
        },
      });
    } catch (error) {
      this.rethrowAssignmentWriteError(error);
    }
  }

  async updateModifierGroupAssignment(
    user: JwtPayload,
    productId: string,
    groupId: string,
    dto: ReplaceProductModifierGroupItemDto,
  ) {
    await this.validateProductOwnership(user.tenant_id, productId);

    if (!MODIFIER_SELECTION_TYPES.includes(dto.selection_type)) {
      throw new BadRequestException({
        error_code: 'INVALID_MODIFIER_SELECTION_TYPE',
        message: 'selection_type must be SINGLE or MULTIPLE',
      });
    }
    if (dto.required && dto.selection_type === 'MULTIPLE') {
      throw new BadRequestException({
        error_code: 'REQUIRED_MULTIPLE_NOT_SUPPORTED',
        message: 'Required MULTIPLE modifier groups are not supported in V1',
      });
    }

    const assignment = await this.prisma.product_modifier_groups.findFirst({
      where: {
        tenant_id: user.tenant_id,
        product_id: productId,
        modifier_group_id: groupId,
      },
      select: { tenant_id: true, product_id: true, modifier_group_id: true },
    });
    if (!assignment) {
      throw new NotFoundException({
        error_code: 'MODIFIER_GROUP_ASSIGNMENT_NOT_FOUND',
        message: 'Modifier group assignment not found',
      });
    }

    const group = await this.prisma.modifier_groups.findFirst({
      where: {
        tenant_id: user.tenant_id,
        id: dto.modifier_group_id,
        is_active: true,
      },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException({
        error_code: 'MODIFIER_GROUP_NOT_FOUND',
        message: 'Active modifier group not found',
      });
    }

    if (dto.modifier_group_id !== groupId) {
      const existing = await this.prisma.product_modifier_groups.findFirst({
        where: {
          tenant_id: user.tenant_id,
          product_id: productId,
          modifier_group_id: dto.modifier_group_id,
        },
        select: { modifier_group_id: true },
      });
      if (existing) {
        throw new ConflictException({
          error_code: 'MODIFIER_GROUP_ALREADY_ASSIGNED',
          message: 'Modifier group already assigned to this product',
        });
      }
    }

    try {
      return await this.prisma.product_modifier_groups.update({
        where: { tenant_id_product_id_modifier_group_id: { tenant_id: user.tenant_id, product_id: productId, modifier_group_id: groupId } },
        data: {
          modifier_group_id: dto.modifier_group_id,
          required: dto.required,
          selection_type: dto.selection_type,
          display_order: dto.display_order,
        },
      });
    } catch (error) {
      this.rethrowAssignmentWriteError(error);
    }
  }

  async removeModifierGroup(
    user: JwtPayload,
    productId: string,
    groupId: string,
  ) {
    await this.validateProductOwnership(user.tenant_id, productId);

    const assignment = await this.prisma.product_modifier_groups.findFirst({
      where: {
        tenant_id: user.tenant_id,
        product_id: productId,
        modifier_group_id: groupId,
      },
      select: { tenant_id: true, product_id: true, modifier_group_id: true },
    });
    if (!assignment) {
      throw new NotFoundException({
        error_code: 'MODIFIER_GROUP_ASSIGNMENT_NOT_FOUND',
        message: 'Modifier group assignment not found',
      });
    }

    return this.prisma.product_modifier_groups.delete({
      where: { tenant_id_product_id_modifier_group_id: { tenant_id: user.tenant_id, product_id: productId, modifier_group_id: groupId } },
    });
  }

  private stockInclude(user: JwtPayload) {
    if (!user.outlet_id) {
      return false;
    }
    return {
      where: {
        outlet_id: user.outlet_id,
        outlets: { tenant_id: user.tenant_id },
      },
      select: { stock: true },
    };
  }

  private resolveStock(
    track_stock: boolean,
    product_stocks: Array<{ stock: number }>,
    outletId: string | null,
  ): number | null {
    if (!track_stock || !outletId) {
      return null;
    }
    return product_stocks.length > 0 ? product_stocks[0].stock : 0;
  }

  private async validateProductOwnership(
    tenantId: string,
    productId: string,
  ): Promise<void> {
    const product = await this.prisma.products.findFirst({
      where: { id: productId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({
        error_code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      });
    }
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
      throw new NotFoundException({
        error_code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }
  }

  private rethrowProductWriteError(error: unknown): never {
    if (
      isUniqueConstraintViolation(error, 'uq_products_tenant_sku', [
        'tenant_id',
        'sku',
      ])
    ) {
      throw new ConflictException({
        error_code: 'SKU_ALREADY_EXISTS',
        message: 'Product SKU already exists',
      });
    }
    throw error;
  }

  private rethrowAssignmentWriteError(error: unknown): never {
    if (
      isUniqueConstraintViolation(error, 'product_modifier_groups_pkey', [
        'tenant_id',
        'product_id',
        'modifier_group_id',
      ])
    ) {
      throw new ConflictException({
        error_code: 'MODIFIER_GROUP_ALREADY_ASSIGNED',
        message: 'Modifier group already assigned to this product',
      });
    }
    throw error;
  }
}
