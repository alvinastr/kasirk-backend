import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DailySalesQueryDto {
  @IsISO8601({ strict: true })
  @Matches(DATE_ONLY, { message: 'date must use YYYY-MM-DD format' })
  date: string;

  @IsOptional()
  @IsUUID()
  outlet_id?: string;
}
