import { IsString, Matches } from 'class-validator';

export class SetUserPinDto {
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'pin must contain exactly 6 digits',
  })
  pin: string;
}
