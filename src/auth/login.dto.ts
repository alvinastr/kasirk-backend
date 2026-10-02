import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsUUID } from "class-validator";

export class LoginDto {
    @ApiProperty({
        type: String,
        format: 'email',
        description: 'User email address.',
    })
    @IsEmail()
    email: string;

    @ApiProperty({
        type: String,
        format: 'password',
        writeOnly: true,
        description: 'User password.',
    })
    @IsString()
    @IsNotEmpty()
    password: string;

    @ApiProperty({
        type: String,
        format: 'uuid',
        description: 'Tenant identifier.',
    })
    @IsUUID()
    tenant_id: string;
}