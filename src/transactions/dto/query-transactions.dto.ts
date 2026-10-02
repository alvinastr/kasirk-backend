import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsUUID,
  Matches,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
} from 'class-validator';
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';
import { TransactionStatus } from '../types/transaction.types';

// UTC timestamps with millisecond precision or less, matching JavaScript Date.
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)$/;

function queryInteger(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

@ValidatorConstraint({ name: 'endDateAfterStartDate', async: false })
class EndDateAfterStartDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const { start_date } = args.object as QueryTransactionsDto;
    if (typeof start_date !== 'string' || typeof value !== 'string') {
        return true; // Individual field validators handle malformed dates.
    }
    const start = Date.parse(start_date);
    const end = Date.parse(value);
    return !Number.isFinite(start) || !Number.isFinite(end) || end > start;
  }

  defaultMessage(): string {
    return 'end_date must be later than start_date';
  }
}

export class QueryTransactionsDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Outlet identifier filter.',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID()
  outlet_id?: string;

  @ApiPropertyOptional({
    enum: TransactionStatus,
    nullable: true,
    description: 'Transaction status filter.',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    pattern: 'UTC_TIMESTAMP',
    description: 'Start of the query range as an ISO 8601 UTC timestamp.',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(UTC_TIMESTAMP, { message: 'start_date must be an ISO 8601 UTC timestamp' })
  start_date?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    pattern: 'UTC_TIMESTAMP',
    description: 'End of the query range as an ISO 8601 UTC timestamp.',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(UTC_TIMESTAMP, { message: 'end_date must be an ISO 8601 UTC timestamp' })
  @Validate(EndDateAfterStartDateConstraint)
  end_date?: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    default: 1,
    description: 'Page number.',
  })
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page: number = 1;

  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Page size.',
  })
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
