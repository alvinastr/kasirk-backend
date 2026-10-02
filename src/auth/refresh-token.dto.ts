import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    type: String,
    format: 'password',
    writeOnly: true,
    minLength: 32,
    maxLength: 512,
    description: 'Refresh token.',
  })
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  refresh_token: string;
}
