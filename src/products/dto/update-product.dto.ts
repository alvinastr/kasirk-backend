import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export class UpdateProductDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 150,
    description: 'Product name. Must contain at least one non-whitespace character.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: 'Product SKU. Must contain at least one non-whitespace character.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 2147483647,
    description: 'Product price in smallest currency unit.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  price?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 2147483647,
    description: 'Product cost in smallest currency unit.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  cost?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 2147483647,
    description: 'Minimum stock level for this product.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  minimum_stock?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Category identifier. Null if product has no category.',
  })
  @IsOptional()
  @IsUUID()
  category_id?: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Whether to track stock levels for this product.',
  })
  @IsOptional()
  @IsBoolean()
  track_stock?: boolean;
}
