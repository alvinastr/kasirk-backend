import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Delete, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { ModifierGroupsService } from './modifier-groups.service';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto';
import { CreateModifierOptionDto } from './dto/create-modifier-option.dto';
import { UpdateModifierOptionDto } from './dto/update-modifier-option.dto';

@ApiTags('Modifier Groups')
@Controller('modifier-groups')
@UseGuards(JwtGuard, RolesGuard)
@ApiBearerAuth('JWT')
export class ModifierGroupsController {
  constructor(private readonly modifierGroupsService: ModifierGroupsService) {}

  @Get()
  @ApiOperation({
    summary: 'List all modifier groups',
    description: 'Retrieve all modifier groups within the authenticated user\'s tenant. Available to all authenticated roles.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Tenant mismatch' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.modifierGroupsService.findAll(user);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Create a new modifier group',
    description: 'Add a modifier group for product configuration. OWNER and ADMIN roles only.',
  })
  @ApiCreatedResponse({ description: 'Modifier group created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid modifier group data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiConflictResponse({ description: 'Modifier group name already exists in tenant' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateModifierGroupDto,
  ) {
    return this.modifierGroupsService.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a modifier group by ID',
    description: 'Retrieve a modifier group by its ID. Available to all authenticated roles.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Modifier group UUID',
  })
  @ApiOkResponse({ description: 'Modifier group found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Tenant mismatch' })
  @ApiNotFoundResponse({ description: 'Modifier group not found' })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.modifierGroupsService.findOne(user, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Update a modifier group',
    description: 'Modify a modifier group. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Modifier group UUID',
  })
  @ApiOkResponse({ description: 'Modifier group updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid modifier group data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Modifier group not found' })
  @ApiConflictResponse({ description: 'Modifier group name already exists in tenant' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateModifierGroupDto,
  ) {
    return this.modifierGroupsService.update(user, id, dto);
  }

  // --- Options ---

  @Post(':id/options')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Create a modifier option',
    description: 'Add an option to a modifier group. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Modifier group UUID',
  })
  @ApiCreatedResponse({ description: 'Modifier option created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid modifier option data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiConflictResponse({ description: 'Modifier option name already exists in this group' })
  @ApiNotFoundResponse({ description: 'Modifier group not found' })
  createOption(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) groupId: string,
    @Body() dto: CreateModifierOptionDto,
  ) {
    return this.modifierGroupsService.createOption(user, groupId, dto);
  }

  @Patch(':id/options/:option_id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Update a modifier option',
    description: 'Modify a modifier option. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Modifier group UUID',
  })
  @ApiParam({
    name: 'option_id',
    type: 'string',
    format: 'uuid',
    description: 'Modifier option UUID',
  })
  @ApiOkResponse({ description: 'Modifier option updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid modifier option data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Modifier option not found' })
  @ApiConflictResponse({ description: 'Modifier option name already exists in this group' })
  updateOption(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) groupId: string,
    @Param('option_id', new ParseUUIDPipe()) optionId: string,
    @Body() dto: UpdateModifierOptionDto,
  ) {
    return this.modifierGroupsService.updateOption(user, groupId, optionId, dto);
  }

  @Delete(':id/options/:option_id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Delete a modifier option (soft delete)',
    description: 'Deactivate a modifier option. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Modifier group UUID',
  })
  @ApiParam({
    name: 'option_id',
    type: 'string',
    format: 'uuid',
    description: 'Modifier option UUID',
  })
  @ApiNoContentResponse({ description: 'Modifier option deleted successfully' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'Modifier option not found' })
  removeOption(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) groupId: string,
    @Param('option_id', new ParseUUIDPipe()) optionId: string,
  ) {
    return this.modifierGroupsService.removeOption(user, groupId, optionId);
  }
}
