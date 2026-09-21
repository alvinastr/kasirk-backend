import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import type { CreateCategoryDto } from './dto/create-category.dto';
import { isUniqueConstraintViolation } from '../common/utils/prisma-error.util';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: JwtPayload) {
    return this.prisma.categories.findMany({
      where: {
        tenant_id: user.tenant_id,
      },
    });
  }

  async create(user: JwtPayload, dto: CreateCategoryDto) {
    try {
      return await this.prisma.categories.create({
        data: {
          tenant_id: user.tenant_id,
          name: dto.name,
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
}
