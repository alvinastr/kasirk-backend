import { IsString, Matches } from 'class-validator';

export class ResolveStoreDto {
  @IsString()
  @Matches(/^[A-Z0-9-]{3,32}$/, {
    message:
      'store_code must be 3-32 characters using uppercase letters, numbers, or hyphens',
  })
  store_code: string;
}
