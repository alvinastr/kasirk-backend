import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

export class CreateStockAdjustmentDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Outlet identifier.',
  })
  @IsUUID()
  outlet_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Product identifier.',
  })
  @IsUUID()
  product_id: string;

  @ApiProperty({
    enum: ['ADD', 'DEDUCT'],
    description: 'Adjustment type.',
  })
  @IsIn(['ADD', 'DEDUCT'])
  adjustment_type: 'ADD' | 'DEDUCT';

  @ApiProperty({
    type: Number,
    minimum: 1,
    description: 'Quantity to add or deduct.',
  })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Reason for adjustment. Must not be blank.',
  })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  reason?: string | null;
}
