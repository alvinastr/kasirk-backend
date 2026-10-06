import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateHeldOrderItemDto } from './create-held-order-item.dto';

export class UpdateHeldOrderDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expected_version: number;

  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(100)
  label?: string | null;

  @ApiPropertyOptional({ type: [CreateHeldOrderItemDto], minItems: 1 })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateHeldOrderItemDto)
  items?: CreateHeldOrderItemDto[];
}
