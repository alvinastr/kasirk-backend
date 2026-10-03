import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateModifierGroupDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 150,
    description: 'Modifier group name. Must contain at least one non-whitespace character.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Whether the group is active.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description: 'Display order for sorting. Lower values appear first.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  display_order?: number;
}
