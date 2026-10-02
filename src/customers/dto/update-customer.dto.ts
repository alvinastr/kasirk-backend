import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateCustomerDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 150,
    description: 'Customer display name.',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 30,
    nullable: true,
    description: 'Customer phone number. Null clears value when service supports clearing.',
  })
  @ValidateIf(
    (_object: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    maxLength: 255,
    nullable: true,
    description: 'Customer email address. Null clears value when service supports clearing.',
  })
  @ValidateIf(
    (_object: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @IsEmail()
  @MaxLength(255)
  email?: string | null;
}
