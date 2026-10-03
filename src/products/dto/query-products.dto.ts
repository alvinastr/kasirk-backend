import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryProductsDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive search query for product name or SKU. Empty or omitted means no text filter.',
    example: 'latte',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({
    description:
      'Filter products by category UUID. Must be a tenant-owned category. Omitted means all categories (Semua).',
    example: '4a0e0000-0000-4000-8000-000000000010',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  category_id?: string;

  @ApiPropertyOptional({
    description:
      'Include active modifier group assignments and options in the response. Defaults to true for POS consumers.',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  include_modifiers?: boolean;
}
