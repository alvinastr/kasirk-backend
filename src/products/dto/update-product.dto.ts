import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minimum_stock?: number;

  @IsOptional()
  @IsUUID()
  category_id?: string | null;

  @IsOptional()
  @IsBoolean()
  track_stock?: boolean;
}
