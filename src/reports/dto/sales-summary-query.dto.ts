import {
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Validate,
  ValidatorConstraint,
} from 'class-validator';
import type {
  ValidationArguments,
  ValidatorConstraintInterface,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@ValidatorConstraint({ name: 'reportEndDateAfterStartDate', async: false })
class ReportEndDateAfterStartDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const { start_date } = args.object as SalesSummaryQueryDto;
    if (typeof start_date !== 'string' || typeof value !== 'string') {
      return true;
    }

    const start = Date.parse(`${start_date}T00:00:00+07:00`);
    const end = Date.parse(`${value}T00:00:00+07:00`);
    return !Number.isFinite(start) || !Number.isFinite(end) || end > start;
  }

  defaultMessage(): string {
    return 'end_date must be later than start_date';
  }
}

export class SalesSummaryQueryDto {
  @IsISO8601({ strict: true })
  @Matches(DATE_ONLY, { message: 'start_date must use YYYY-MM-DD format' })
  start_date: string;

  @IsISO8601({ strict: true })
  @Matches(DATE_ONLY, { message: 'end_date must use YYYY-MM-DD format' })
  @Validate(ReportEndDateAfterStartDateConstraint)
  end_date: string;

  @IsOptional()
  @IsUUID()
  outlet_id?: string;
}
