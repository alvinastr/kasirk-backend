import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from "class-validator";

export class CreateOutletDto {

    @ApiProperty({
        type: String,
        description: 'Outlet name.',
    })
    @IsString()
    name:string;

    @ApiPropertyOptional({
        type: String,
        description: 'Outlet address.',
    })
    @IsOptional()
    @IsString()
    address?:string;
}