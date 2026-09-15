import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsDefined,
    IsInt,
    IsObject,
    IsUUID,
    Max,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { CreateTransactionItemDto } from './create-transaction-item.dto';
import { CreateTransactionPaymentDto } from './create-transaction-payment.dto';

export class CreateTransactionDto {
    @IsUUID()
    client_transaction_id: string;

    @IsUUID()
    outlet_id: string;

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
    @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
    @IsInt()
    @Min(0)
    @Max(Number.MAX_SAFE_INTEGER)
    discount: number = 0;

    @IsDefined()
    @IsObject()
    @ValidateNested()
    @Type(() => CreateTransactionPaymentDto)
    payment: CreateTransactionPaymentDto;
}
