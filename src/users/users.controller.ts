import {Body, Controller, Get, Post, UseGuards} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { UsersService } from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
@UseGuards(JwtGuard)
export class UsersController {
    constructor(
        private userService:UsersService
    ) {}

    @Get()
    findAll(
        @CurrentUser() user: JwtPayload
    ){
        return this.userService.findAll(user);
    }

    @Post()
    create(
        @CurrentUser() user: JwtPayload,
        @Body() dto: CreateUserDto
    ){
        return this.userService.create(user, dto);
    }
}
