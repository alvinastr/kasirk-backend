import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class PinLoginDto {
  @IsUUID()
  tenant_id: string;

  @IsUUID()
  user_id: string;

  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'pin must contain exactly 6 digits',
  })
  pin: string;

  @IsUUID()
  device_id: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  device_name?: string;
}
