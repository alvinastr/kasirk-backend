import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomersService } from './customers.service';

@Controller('customers')
@UseGuards(JwtGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @Roles('OWNER', 'ADMIN', 'CASHIER')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.customersService.findAll(user);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user, dto);
  }

  @Get(':id/transactions')
  @Roles('OWNER', 'ADMIN')
  transactionHistory(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.customersService.transactionHistory(user, id);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN', 'CASHIER')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.customersService.findOne(user, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.customersService.remove(user, id);
  }
}
