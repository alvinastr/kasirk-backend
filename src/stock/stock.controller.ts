import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from '@nestjs/common';

import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtGuard } from '../auth/jwt.guard';

import { CurrentUser } from '../common/decorators/current-user.decorator';

import type { JwtPayload } from '../auth/types/jwt-payload.type';

import { StockService } from './stock.service';

import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';



@ApiTags('Stock')

@Controller('stock')

@UseGuards(JwtGuard, RolesGuard)

@ApiBearerAuth('JWT')

export class StockController {


    constructor(
        private stockService: StockService
    ){}



    @Get(':outlet_id')

    @ApiOperation({
        summary: 'Get stock levels by outlet',
        description: 'Retrieve current stock quantities for all products at a specific outlet. Available to all authenticated roles.',
    })
    @ApiParam({
        name: 'outlet_id',
        type: 'string',
        format: 'uuid',
        description: 'Outlet UUID',
    })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
    @ApiForbiddenResponse({ description: 'Tenant mismatch' })
    @ApiNotFoundResponse({ description: 'Outlet not found' })

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

    @ApiOperation({
        summary: 'Create stock adjustment',
        description: 'Manually adjust stock quantity for a product at an outlet with reason and notes. OWNER and ADMIN roles only.',
    })
    @ApiBadRequestResponse({ description: 'Invalid adjustment data or product not tracked' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
    @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
    @ApiNotFoundResponse({ description: 'Product or outlet not found' })

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
