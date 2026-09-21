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

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(150)
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  sku: string;

  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  price: number;

  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  cost: number;

  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  minimum_stock: number;

  @IsOptional()
  @IsUUID()
  category_id?: string | null;

  @IsOptional()
  @IsBoolean()
  track_stock?: boolean;
}
