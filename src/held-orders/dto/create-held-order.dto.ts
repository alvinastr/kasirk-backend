import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateHeldOrderItemDto } from './create-held-order-item.dto';

export class CreateHeldOrderDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  outlet_id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  cashier_session_id: string;

  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiProperty({ type: [CreateHeldOrderItemDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateHeldOrderItemDto)
  items: CreateHeldOrderItemDto[];
}
