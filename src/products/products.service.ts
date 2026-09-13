import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateProductDto } from './dto/create-product.dto';


@Injectable()
export class ProductsService {

    constructor(
    private prisma: PrismaService
    ){}

    async findAll(
        user:JwtPayload
    ){

    return this.prisma.products.findMany({
        where:{
        tenant_id:user.tenant_id,

        is_active:true
        }
    });

    }

    async create(
        user:JwtPayload,
        dto:CreateProductDto
    ){
        return this.prisma.products.create({
            data:{
                tenant_id:user.tenant_id,
                name:dto.name,
                sku:dto.sku,
                price:dto.price,
                cost:dto.cost,
                minimum_stock:dto.minimum_stock,
                category_id:dto.category_id ?? null
            }
        });
    }

}