import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { HeldOrderStatus } from '../types/held-order.types';

function queryInteger(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

export class QueryHeldOrdersDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID()
  outlet_id?: string;

  @ApiPropertyOptional({ enum: HeldOrderStatus, default: HeldOrderStatus.OPEN })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(HeldOrderStatus)
  status: HeldOrderStatus = HeldOrderStatus.OPEN;

  @ApiProperty({ type: Number, minimum: 1, default: 1 })
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page: number = 1;

  @ApiProperty({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
