import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import { isUniqueConstraintViolation } from '../common/utils/prisma-error.util';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: JwtPayload) {
    return this.prisma.categories.findMany({
      where: {
        tenant_id: user.tenant_id,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(user: JwtPayload, id: string) {
    const category = await this.prisma.categories.findFirst({
      where: {
        id,
        tenant_id: user.tenant_id,
      },
    });
    if (!category) {
      throw new NotFoundException({
        error_code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }
    return category;
  }

  async create(user: JwtPayload, dto: CreateCategoryDto) {
    try {
      return await this.prisma.categories.create({
        data: {
          tenant_id: user.tenant_id,
          name: dto.name.trim(),
        },
      });
    } catch (error) {
      if (
        isUniqueConstraintViolation(error, 'uq_categories_tenant_name', [
          'tenant_id',
          'name',
        ])
      ) {
        throw new ConflictException({
          error_code: 'CATEGORY_NAME_ALREADY_EXISTS',
          message: 'Category name already exists',
        });
      }
      throw error;
    }
  }

  async update(user: JwtPayload, id: string, dto: UpdateCategoryDto) {
    await this.findOne(user, id);
    try {
      return await this.prisma.categories.update({
        where: { id },
        data: {
          name: dto.name.trim(),
        },
      });
    } catch (error) {
      if (
        isUniqueConstraintViolation(error, 'uq_categories_tenant_name', [
          'tenant_id',
          'name',
        ])
      ) {
        throw new ConflictException({
          error_code: 'CATEGORY_NAME_ALREADY_EXISTS',
          message: 'Category name already exists',
        });
      }
      throw error;
    }
  }

  async remove(user: JwtPayload, id: string) {
    await this.findOne(user, id);
    const inUseCount = await this.prisma.products.count({
      where: {
        tenant_id: user.tenant_id,
        category_id: id,
      },
    });
    if (inUseCount > 0) {
      throw new ConflictException({
        error_code: 'CATEGORY_IN_USE',
        message: 'Cannot delete category that is currently assigned to products',
      });
    }
    return this.prisma.categories.delete({
      where: { id },
    });
  }
}
