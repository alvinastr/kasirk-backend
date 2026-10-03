import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateModifierGroupDto {
  @ApiProperty({
    type: String,
    maxLength: 150,
    description: 'Modifier group name. Must contain at least one non-whitespace character.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Whether the group is active. Defaults to true.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description: 'Display order for sorting. Lower values appear first. Defaults to 0.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  display_order?: number;
}
