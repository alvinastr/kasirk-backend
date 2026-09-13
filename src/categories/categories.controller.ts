import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';

import { CategoriesService } from './categories.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateCategoryDto } from './dto/create-category.dto';

@Controller('categories')
@UseGuards(JwtGuard)
export class CategoriesController {

    constructor(
        private categoriesService: CategoriesService
    ){}

    @Get()
    findAll(
        @CurrentUser() user: JwtPayload
    ){
        return this.categoriesService.findAll(user);
    }

    @Post()
    create(
        @CurrentUser() user: JwtPayload,
        @Body() dto: CreateCategoryDto
    ){
        console.log(dto);
        return this.categoriesService.create(user, dto);
    }
    
}
