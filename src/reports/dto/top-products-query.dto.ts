import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { SalesSummaryQueryDto } from './sales-summary-query.dto';

function queryInteger(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
}

export class TopProductsQueryDto extends SalesSummaryQueryDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 10,
    description: 'Maximum number of products to return. Range 1–100.',
  })
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
