import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { OutletsService } from './outlets.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateOutletDto } from './dto/create-outlet.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Outlets')
@Controller('outlets')
@UseGuards(JwtGuard, RolesGuard)
@ApiBearerAuth('JWT')
export class OutletsController {

    constructor(
        private service: OutletsService
    ){}

    @Get()
    @ApiOperation({
        summary: 'List all outlets',
        description: 'Retrieve all outlets within the authenticated user\'s tenant. Available to all authenticated roles.',
    })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
    @ApiForbiddenResponse({ description: 'Tenant mismatch' })
    findAll(
        @CurrentUser() user: JwtPayload
    ){
        return this.service.findAll(user);
    }

    @Post()
    @Roles('OWNER')
    @ApiOperation({
        summary: 'Create a new outlet',
        description: 'Register a new outlet/store location. OWNER role only.',
    })
    @ApiBadRequestResponse({ description: 'Invalid outlet data' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
    @ApiForbiddenResponse({ description: 'Insufficient role (OWNER required)' })
    @ApiConflictResponse({ description: 'Outlet name already exists in tenant' })
    create(
        @CurrentUser() user: JwtPayload,
        @Body() dto: CreateOutletDto
    ){
        return this.service.create(user, dto);
    }
}
