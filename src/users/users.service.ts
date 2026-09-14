import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {

    constructor(
        private prisma: PrismaService
    ){}

    async findAll(
        user:JwtPayload
    ){
        return this.prisma.users.findMany({
            where:{
                tenant_id:user.tenant_id,
                is_active:true
            },

            select:{
                id:true,
                name:true,
                email:true,
                role:true,
                outlet_id:true,
                created_at:true,
            }
        });
    }

    async create(
        user:JwtPayload,
        dto:CreateUserDto
    ){
        if (dto.outlet_id != null) {
            const outlet = await this.prisma.outlets.findFirst({
                where: { id: dto.outlet_id, tenant_id: user.tenant_id },
                select: { id: true },
            });
            if (!outlet) {
                throw new NotFoundException('Outlet not found');
            }
        }

        const password_hash = await bcrypt.hash(
            dto.password,
            10
        );

        return this.prisma.users.create({
            data:{
                tenant_id:user.tenant_id,
                name:dto.name,
                email:dto.email,
                password_hash,
                role:dto.role,
                outlet_id:dto.outlet_id
            },
            select: {
                id: true,
                tenant_id: true,
                name: true,
                email: true,
                role: true,
                outlet_id: true,
                is_active: true,
                created_at: true,
            }
        });
    }
}
