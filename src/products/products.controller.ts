import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateProductDto } from './dto/create-product.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateProductDto } from './dto/update-product.dto';
import { ReplaceProductModifierGroupsDto } from './dto/replace-product-modifier-groups.dto';

@ApiTags('Products')
@Controller('products')
@UseGuards(JwtGuard, RolesGuard)
@ApiBearerAuth('JWT')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'List all products',
    description: 'Retrieve all products within the authenticated user\'s tenant. Available to all authenticated roles.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Tenant mismatch' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.productsService.findAll(user);
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
