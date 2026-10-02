import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from "class-validator";


export class CreateUserDto {

    @ApiProperty({
        type: String,
        description: 'User display name.',
    })
    @IsString()
    @IsNotEmpty()
    name:string;

    @ApiProperty({
        type: String,
        description: 'User email address.',
    })
    @IsString()
    email:string;

    @ApiProperty({
        type: String,
        format: 'password',
        writeOnly: true,
        description: 'User password.',
    })
    @IsString()
    password:string;

    @ApiProperty({
        type: String,
        description: 'User role.',
    })
    @IsString()
    role:string;

    @ApiPropertyOptional({
        type: String,
        description: 'Outlet identifier.',
    })
    @IsOptional()
    @IsString()
    outlet_id?:string;
}