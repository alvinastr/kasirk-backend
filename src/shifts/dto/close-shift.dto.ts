import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class CloseShiftDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  closing_cash!: number;
}
