import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export class UpdateModifierOptionDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 150,
    description: 'Modifier option name. Must contain at least one non-whitespace character.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 2147483647,
    description: 'Price delta in integer Rupiah. Must be non-negative.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  price_delta?: number;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Whether the option is active.',
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
