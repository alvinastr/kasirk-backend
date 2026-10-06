import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Delete, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateProductDto } from './dto/update-product.dto';
import { ReplaceProductModifierGroupsDto, ReplaceProductModifierGroupItemDto } from './dto/replace-product-modifier-groups.dto';

@ApiTags('Products')
@Controller('products')
@UseGuards(JwtGuard, RolesGuard)
@ApiBearerAuth('JWT')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'List all products',
    description:
      'Retrieve all products within the authenticated user\'s tenant. Available to all authenticated roles. Optional q (case-insensitive name/SKU search), category_id (tenant-owned category filter), and include_modifiers (default true) query parameters are supported.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description: 'Case-insensitive search query for product name or SKU',
  })
  @ApiQuery({
    name: 'category_id',
    required: false,
    type: String,
    format: 'uuid',
    description: 'Filter by tenant-owned category UUID',
  })
  @ApiQuery({
    name: 'include_modifiers',
    required: false,
    type: Boolean,
    description: 'Include active modifier groups/options (default true)',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Tenant mismatch' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryProductsDto,
  ) {
    return this.productsService.findAll(user, query);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Create a new product',
    description: 'Add a product to inventory with pricing, category, and stock tracking settings. OWNER and ADMIN roles only.',
  })
  @ApiBadRequestResponse({ description: 'Invalid product data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiConflictResponse({ description: 'SKU already exists in tenant' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateProductDto) {
    return this.productsService.create(user, dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Update a product',
    description: 'Modify product details including name, price, category, and stock tracking settings. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Product UUID',
  })
  @ApiBadRequestResponse({ description: 'Invalid product data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiConflictResponse({ description: 'SKU already exists in tenant' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(user, id, dto);
  }

  @Get(':product_id/modifier-groups')
  @ApiOperation({
    summary: 'Get modifier group assignments for a product',
    description: 'Retrieve active modifier group assignments and their currently active options for the product. Available to all authenticated roles.',
  })
  @ApiParam({
    name: 'product_id',
    type: 'string',
    format: 'uuid',
    description: 'Product UUID',
  })
  @ApiOkResponse({ description: 'Product modifier group assignments' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Tenant mismatch' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  getModifierGroups(
    @CurrentUser() user: JwtPayload,
    @Param('product_id', new ParseUUIDPipe()) productId: string,
  ) {
    return this.productsService.getModifierGroups(user, productId);
  }

  @Post(':product_id/modifier-groups')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Assign a modifier group to a product',
    description: 'Add a modifier group assignment to a product. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'product_id',
    type: 'string',
    format: 'uuid',
    description: 'Product UUID',
  })
  @ApiOkResponse({ description: 'Modifier group assigned successfully' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Product or modifier group not found' })
  @ApiConflictResponse({ description: 'Modifier group already assigned to product' })
  assignModifierGroup(
    @CurrentUser() user: JwtPayload,
    @Param('product_id', new ParseUUIDPipe()) productId: string,
    @Body() dto: ReplaceProductModifierGroupItemDto,
  ) {
    return this.productsService.assignModifierGroup(user, productId, dto);
  }

  @Patch(':product_id/modifier-groups/:group_id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Update product modifier group assignment',
    description: 'Update modifier group assignment flags for a product. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'product_id',
    type: 'string',
    format: 'uuid',
    description: 'Product UUID',
  })
  @ApiParam({
    name: 'group_id',
    type: 'string',
    format: 'uuid',
    description: 'Modifier group UUID',
  })
  @ApiOkResponse({ description: 'Modifier group assignment updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid assignment data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Product or modifier group not found' })
  @ApiConflictResponse({ description: 'Duplicate modifier group assignment' })
  updateModifierGroupAssignment(
    @CurrentUser() user: JwtPayload,
    @Param('product_id', new ParseUUIDPipe()) productId: string,
    @Param('group_id', new ParseUUIDPipe()) groupId: string,
    @Body() dto: ReplaceProductModifierGroupItemDto,
  ) {
    return this.productsService.updateModifierGroupAssignment(user, productId, groupId, dto);
  }

  @Delete(':product_id/modifier-groups/:group_id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Remove modifier group from product',
    description: 'Remove a modifier group assignment from a product. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'product_id',
    type: 'string',
    format: 'uuid',
    description: 'Product UUID',
  })
  @ApiParam({
    name: 'group_id',
    type: 'string',
    format: 'uuid',
    description: 'Modifier group UUID',
  })
  @ApiOkResponse({ description: 'Modifier group removed successfully' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Product or modifier group not found' })
  removeModifierGroup(
    @CurrentUser() user: JwtPayload,
    @Param('product_id', new ParseUUIDPipe()) productId: string,
    @Param('group_id', new ParseUUIDPipe()) groupId: string,
  ) {
    return this.productsService.removeModifierGroup(user, productId, groupId);
  }

  @Put(':product_id/modifier-groups')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Replace product modifier group assignments',
    description: 'Atomically replace all modifier group assignments for a product. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'product_id',
    type: 'string',
    format: 'uuid',
    description: 'Product UUID',
  })
  @ApiOkResponse({ description: 'Product modifier groups replaced successfully' })
  @ApiBadRequestResponse({ description: 'Invalid assignment data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Product or modifier group not found' })
  @ApiConflictResponse({ description: 'Duplicate modifier group assignment' })
  replaceModifierGroups(
    @CurrentUser() user: JwtPayload,
    @Param('product_id', new ParseUUIDPipe()) productId: string,
    @Body() dto: ReplaceProductModifierGroupsDto,
  ) {
    return this.productsService.replaceModifierGroups(user, productId, dto);
  }
}
