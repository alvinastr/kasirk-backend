import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './login.dto';

@Injectable()
export class AuthService {

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService
    ){}

    async login(dto: LoginDto){

        const user = await this.prisma.users.findUnique({
            where: {
                tenant_id_email:{
                    tenant_id: dto.tenant_id,
                    email: dto.email
                } 
            },
        });

        if(!user){
            throw new UnauthorizedException(
                'Email atau password salah'
            );
        }

        const passwordValid = await bcrypt.compare(
            dto.password, 
            user.password_hash
        );

        if (!passwordValid) {
            throw new UnauthorizedException(
                'Email atau password salah'
            );
        }

        const payload = {
            sub: user.id,
            tenant_id: user.tenant_id,
            role: user.role,
        };

        return {
            access_token: this.jwtService.sign(payload),
        }
    }
}
