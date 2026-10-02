import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class CloseShiftDto {
  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Closing cash amount in smallest currency unit.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  closing_cash!: number;
}
