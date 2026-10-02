import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({
    type: String,
    maxLength: 150,
    description: 'Customer display name.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 30,
    description: 'Customer phone number.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    maxLength: 255,
    description: 'Customer email address.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
