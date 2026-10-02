import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class OpenShiftDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Outlet identifier.',
  })
  @IsUUID()
  outlet_id!: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Opening cash amount in smallest currency unit.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  opening_cash!: number;
}
