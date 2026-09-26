import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { JwtPayload } from './types/jwt-payload.type';
import { LoginDto } from './login.dto';
import { JwtGuard } from './jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResolveStoreDto } from './resolve-store.dto';
import { PinLoginDto } from './pin-login.dto';
import { RefreshTokenDto } from './refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('v2/store/resolve')
  @HttpCode(HttpStatus.OK)
  resolveStore(@Body() dto: ResolveStoreDto) {
    return this.authService.resolveStore(dto);
  }

  @Post('v2/pin/login')
  @HttpCode(HttpStatus.OK)
  pinLogin(@Body() dto: PinLoginDto) {
    return this.authService.pinLogin(dto);
  }

  @Post('v2/refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('v2/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto);
  }

  @UseGuards(JwtGuard)
  @Get('v2/me')
  currentUser(@CurrentUser() user: JwtPayload) {
    return this.authService.getCurrentUser(user);
  }

  @UseGuards(JwtGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
