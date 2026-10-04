import { Type } from 'class-transformer';
import { ArrayMinSize, Equals, IsArray, IsDefined, IsInt, IsObject, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { PaymentMethod } from '../../transactions/types/transaction.types';

class LegacySyncItemDto {
  @IsUUID() product_id!: string;
  @IsInt() @Min(1) @Max(2147483647) quantity!: number;
}
class LegacySyncPaymentDto {
  @Equals(PaymentMethod.CASH) method!: PaymentMethod.CASH;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) amount!: number;
}
export class LegacySyncTransactionDto {
  @IsUUID() client_transaction_id!: string;
  @IsUUID() outlet_id!: string;
  @IsOptional() @IsUUID() customer_id?: string;
  @IsArray() @ArrayMinSize(1) @IsObject({ each: true })
  @ValidateNested({ each: true }) @Type(() => LegacySyncItemDto)
  items!: LegacySyncItemDto[];
  @IsDefined() @IsObject() @ValidateNested() @Type(() => LegacySyncPaymentDto)
  payment!: LegacySyncPaymentDto;
}
