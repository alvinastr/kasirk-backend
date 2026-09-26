import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  refresh_token: string;
}
