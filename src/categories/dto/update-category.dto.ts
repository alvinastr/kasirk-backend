import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateCategoryDto {
  @ApiProperty({
    type: String,
    maxLength: 100,
    description: 'Updated category name. Must contain at least one non-whitespace character.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  name: string;
}
