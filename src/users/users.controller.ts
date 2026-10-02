import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
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
import { UsersService } from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateUserDto } from './dto/create-user.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SetUserPinDto } from './dto/set-user-pin.dto';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtGuard, RolesGuard)
@ApiBearerAuth('JWT')
export class UsersController {
  constructor(private userService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List all users',
    description: 'Retrieve all users within the authenticated user\'s tenant. Available to all authenticated roles.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Tenant mismatch' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.userService.findAll(user);
  }

  @Post()
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Create a new user',
    description: 'Register a new user account with role and outlet assignments. OWNER role only.',
  })
  @ApiBadRequestResponse({ description: 'Invalid user data' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER required)' })
  @ApiConflictResponse({ description: 'Email already exists' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    return this.userService.create(user, dto);
  }

  @Post(':id/pin')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set or update user PIN',
    description: 'Set the 6-digit PIN for PIN-based authentication. OWNER and ADMIN roles only.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'User UUID',
  })
  @ApiBadRequestResponse({ description: 'Invalid PIN format' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async setPin(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetUserPinDto,
  ): Promise<void> {
    await this.userService.setPin(user, id, dto);
  }
}
