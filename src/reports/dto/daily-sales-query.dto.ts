import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DailySalesQueryDto {
  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Date in YYYY-MM-DD format (WIB).',
  })
  @IsISO8601({ strict: true })
  @Matches(DATE_ONLY, { message: 'date must use YYYY-MM-DD format' })
  date: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Outlet identifier filter.',
  })
  @IsOptional()
  @IsUUID()
  outlet_id?: string;
}
