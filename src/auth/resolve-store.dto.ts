import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ResolveStoreDto {
  @ApiProperty({
    type: String,
    minLength: 3,
    maxLength: 32,
    pattern: '^[A-Z0-9-]{3,32}$',
    description: 'Store code using uppercase letters, numbers, or hyphens.',
  })
  @IsString()
  @Matches(/^[A-Z0-9-]{3,32}$/, {
    message:
      'store_code must be 3-32 characters using uppercase letters, numbers, or hyphens',
  })
  store_code: string;
}
