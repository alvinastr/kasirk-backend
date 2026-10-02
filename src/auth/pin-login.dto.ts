import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class PinLoginDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Tenant identifier.',
  })
  @IsUUID()
  tenant_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'User identifier.',
  })
  @IsUUID()
  user_id: string;

  @ApiProperty({
    type: String,
    format: 'password',
    writeOnly: true,
    minLength: 6,
    maxLength: 6,
    pattern: '^\\d{6}$',
    description: 'Six-digit user PIN.',
  })
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'pin must contain exactly 6 digits',
  })
  pin: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Device identifier.',
  })
  @IsUUID()
  device_id: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: 'Device name.',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  device_name?: string;
}
