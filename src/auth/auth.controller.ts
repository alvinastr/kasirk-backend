import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import type { JwtPayload } from './types/jwt-payload.type';
import { LoginDto } from './login.dto';
import { JwtGuard } from './jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResolveStoreDto } from './resolve-store.dto';
import { PinLoginDto } from './pin-login.dto';
import { RefreshTokenDto } from './refresh-token.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'Legacy email/password login',
    description: 'Authenticate using email and password. Returns access and refresh tokens.',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('v2/store/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve store by code',
    description: 'Resolve tenant information using store code. First step of v2 authentication flow.',
  })
  resolveStore(@Body() dto: ResolveStoreDto) {
    return this.authService.resolveStore(dto);
  }

  @Post('v2/pin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PIN-based login',
    description: 'Authenticate user with PIN after store resolution. Returns access and refresh tokens.',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid PIN or user not found' })
  pinLogin(@Body() dto: PinLoginDto) {
    return this.authService.pinLogin(dto);
  }

  @Post('v2/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Exchange refresh token for new access and refresh tokens.',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('v2/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Logout and invalidate refresh token',
    description: 'Invalidate the provided refresh token. Client should discard all tokens.',
  })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto);
  }

  @UseGuards(JwtGuard)
  @Get('v2/me')
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Retrieve authenticated user information including tenant, role, and associated outlets.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  currentUser(@CurrentUser() user: JwtPayload) {
    return this.authService.getCurrentUser(user);
  }

  @UseGuards(JwtGuard)
  @Get('me')
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Get JWT payload',
    description: 'Return the decoded JWT payload for the authenticated user.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
