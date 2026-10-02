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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomersService } from './customers.service';

@ApiTags('Customers')
@Controller('customers')
@UseGuards(JwtGuard, RolesGuard)
@ApiBearerAuth('JWT')
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
  @ApiOperation({
    summary: 'List all customers',
    description: 'Retrieve all customers within the authenticated user\'s tenant. OWNER, ADMIN, and CASHIER roles.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role or tenant mismatch' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.customersService.findAll(user);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Create a new customer',
    description: 'Register a customer with name and optional contact information. OWNER and ADMIN roles only.',
  })
  @ApiBadRequestResponse({ description: 'Invalid customer data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiConflictResponse({ description: 'Phone number already exists in tenant' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user, dto);
  }

  @Get(':id/transactions')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Get customer transaction history',
    description: 'Retrieve all transactions associated with a specific customer. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Customer UUID',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Customer not found' })
  transactionHistory(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.customersService.transactionHistory(user, id);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN', 'CASHIER')
  @ApiOperation({
    summary: 'Get customer by ID',
    description: 'Retrieve detailed information for a specific customer. OWNER, ADMIN, and CASHIER roles.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Customer UUID',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role or tenant mismatch' })
  @ApiNotFoundResponse({ description: 'Customer not found' })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.customersService.findOne(user, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Update a customer',
    description: 'Modify customer details including name and contact information. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Customer UUID',
  })
  @ApiBadRequestResponse({ description: 'Invalid customer data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Customer not found' })
  @ApiConflictResponse({ description: 'Phone number already exists in tenant' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Delete a customer',
    description: 'Remove a customer record. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Customer UUID',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Customer not found' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.customersService.remove(user, id);
  }
}
