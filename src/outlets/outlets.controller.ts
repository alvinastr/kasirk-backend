import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { OutletsService } from './outlets.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateOutletDto } from './dto/create-outlet.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@Controller('outlets')
@UseGuards(JwtGuard, RolesGuard)
export class OutletsController {

    constructor(
        private service: OutletsService
    ){}

    @Get()
    findAll(
        @CurrentUser() user: JwtPayload
    ){
        return this.service.findAll(user);
    }

    @Post()
    @Roles('OWNER')
    create(
        @CurrentUser() user: JwtPayload,
        @Body() dto: CreateOutletDto
    ){
        return this.service.create(user, dto);
    }
}
