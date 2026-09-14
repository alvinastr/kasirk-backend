import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { JwtPayload } from './types/jwt-payload.type';
import { LoginDto } from './login.dto';
import { JwtGuard } from './jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {

    constructor(
        private authService: AuthService,  
    ){}

    @Post('login')
    login(
        @Body() dto: LoginDto
    ){
        return this.authService.login(dto);
    }

    @UseGuards(JwtGuard)
    @Get('me')
    me(
        @CurrentUser() user: JwtPayload,
    ){
        return user;
    }
}
