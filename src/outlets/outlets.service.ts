import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateOutletDto } from './dto/create-outlet.dto';

@Injectable()
export class OutletsService {

    constructor(
        private prisma: PrismaService
    ){}

    async findAll(
        user:JwtPayload
    ){
        return this.prisma.outlets.findMany({
            where:{
                tenant_id:user.tenant_id,
                is_active:true
            }
        });
    }

    async create(
        user:JwtPayload,
        dto:CreateOutletDto
    ){
        return this.prisma.outlets.create({
            data:{
                tenant_id:user.tenant_id,
                name:dto.name,
                address:dto.address
            }
        });
    }
}

