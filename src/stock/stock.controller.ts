import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from '@nestjs/common';


import { JwtGuard } from '../auth/jwt.guard';

import { CurrentUser } from '../common/decorators/current-user.decorator';

import type { JwtPayload } from '../auth/types/jwt-payload.type';

import { StockService } from './stock.service';

import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';



@Controller('stock')

@UseGuards(JwtGuard, RolesGuard)

export class StockController {


    constructor(
        private stockService: StockService
    ){}



    @Get(':outlet_id')

    findByOutlet(

        @CurrentUser() user:JwtPayload,

        @Param('outlet_id', new ParseUUIDPipe()) outlet_id:string

    ){

        return this.stockService.findByOutlet(
            user,
            outlet_id
        );

    }





    @Post('adjustment')

    @Roles('OWNER', 'ADMIN')

    createAdjustment(

        @CurrentUser() user:JwtPayload,

        @Body() dto:CreateStockAdjustmentDto

    ){

        return this.stockService.createAdjustment(
            user,
            dto
        );

    }


}
