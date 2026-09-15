import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateProductDto } from './dto/create-product.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';


@Controller('products')
@UseGuards(JwtGuard, RolesGuard)
export class ProductsController {

    constructor(
    private productsService: ProductsService
    ){}

    @Get()
    findAll(
    @CurrentUser() user:JwtPayload
    ){
    return this.productsService.findAll(
        user
    );
    }

    @Post()
    @Roles('OWNER', 'ADMIN')
    create(
        @CurrentUser() user:JwtPayload,
        @Body() dto:CreateProductDto
    ){
        return this.productsService.create(
            user,
            dto
        );
    }

}
