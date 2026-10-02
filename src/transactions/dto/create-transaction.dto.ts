import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateTransactionItemDto } from './create-transaction-item.dto';
import { CreateTransactionPaymentDto } from './create-transaction-payment.dto';

export class CreateTransactionDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Client-generated transaction identifier.',
  })
  @IsUUID()
  client_transaction_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Outlet identifier.',
  })
  @IsUUID()
  outlet_id: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Customer identifier. Null when transaction is anonymous.',
  })
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @ApiProperty({
    type: () => [CreateTransactionItemDto],
    minItems: 1,
    description: 'Line items. Product identifiers must be unique.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: CreateTransactionItemDto | null) =>
    typeof item?.product_id === 'string' ? item.product_id.toLowerCase() : undefined,
    { message: 'items must contain unique product_id values' })
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionItemDto)
  items: CreateTransactionItemDto[];

  // Omission defaults to zero; explicit null is rejected.
  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Discount amount. Defaults to 0.',
    default: 0,
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  discount: number = 0;

  @ApiProperty({
    type: () => CreateTransactionPaymentDto,
    description: 'Payment details.',
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateTransactionPaymentDto)
  payment: CreateTransactionPaymentDto;
}
