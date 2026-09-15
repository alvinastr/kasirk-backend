import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { SalesSummaryQueryDto } from './sales-summary-query.dto';

function queryInteger(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
}

export class TopProductsQueryDto extends SalesSummaryQueryDto {
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
