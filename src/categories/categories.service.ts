import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import type { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {

    constructor(
        private prisma: PrismaService,
    ) {}

    async findAll(
        user: JwtPayload
    ) {
        return this.prisma.categories.findMany({
            where: {
                tenant_id: user.tenant_id
            }
        });
    }

    async create(
        user: JwtPayload,
        dto: CreateCategoryDto
    ) {
        return this.prisma.categories.create({
            data: {
                tenant_id: user.tenant_id,
                name: dto.name
            }
        });
    }
}
