import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CancelHeldOrderDto } from './dto/cancel-held-order.dto';
import { CreateHeldOrderDto } from './dto/create-held-order.dto';
import { QueryHeldOrdersDto } from './dto/query-held-orders.dto';
import { UpdateHeldOrderDto } from './dto/update-held-order.dto';
import { HeldOrdersService } from './held-orders.service';

@ApiTags('Held Orders')
@ApiBearerAuth('JWT')
@Controller('held-orders')
@UseGuards(JwtGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'CASHIER')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class HeldOrdersController {
  constructor(private readonly heldOrdersService: HeldOrdersService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateHeldOrderDto) { return this.heldOrdersService.create(user, dto); }

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryHeldOrdersDto) { return this.heldOrdersService.findAll(user, query); }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id', new ParseUUIDPipe()) id: string) { return this.heldOrdersService.findOne(user, id); }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateHeldOrderDto) { return this.heldOrdersService.update(user, id, dto); }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CancelHeldOrderDto) { return this.heldOrdersService.cancel(user, id, dto); }
}
