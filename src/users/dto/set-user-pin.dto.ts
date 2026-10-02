import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class SetUserPinDto {
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
}
