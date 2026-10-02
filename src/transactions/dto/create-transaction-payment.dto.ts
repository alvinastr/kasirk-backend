import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsEnum,
    IsInt,
    Max,
    Min,
    Validate,
    ValidateIf,
    ValidatorConstraint,
} from 'class-validator';
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';
import { PaymentMethod } from '../types/transaction.types';

@ValidatorConstraint({ name: 'cashAmountOnly', async: false })
class CashAmountOnlyConstraint implements ValidatorConstraintInterface {
    validate(_value: unknown, args: ValidationArguments): boolean {
        return (args.object as CreateTransactionPaymentDto).method === PaymentMethod.CASH;
    }

    defaultMessage(): string {
        return 'amount must not be supplied for QRIS; the server determines the amount';
    }
}

export class CreateTransactionPaymentDto {
    @ApiProperty({
        enum: PaymentMethod,
        description: 'Payment method. Currently service only supports CASH.',
    })
    @IsEnum(PaymentMethod)
    method: PaymentMethod;

    // Missing CASH amount is invalid; any supplied QRIS amount is also invalid.
    @ApiPropertyOptional({
        type: Number,
        minimum: 1,
        description: 'Payment amount. Required for CASH method. Must not be supplied for QRIS.',
    })
    @ValidateIf((payment: CreateTransactionPaymentDto) =>
        payment.method === PaymentMethod.CASH || payment.amount !== undefined)
    @IsInt()
    @Min(1)
    @Max(Number.MAX_SAFE_INTEGER)
    @Validate(CashAmountOnlyConstraint)
    amount?: number;
}
