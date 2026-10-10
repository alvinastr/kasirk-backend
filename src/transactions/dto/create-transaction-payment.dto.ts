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

@ValidatorConstraint({ name: 'paymentTransportShape', async: false })
class PaymentTransportShapeConstraint implements ValidatorConstraintInterface {
    validate(_value: unknown, args: ValidationArguments): boolean {
        const p = args.object as CreateTransactionPaymentDto;
        if (p.method === PaymentMethod.CASH) {
            const hasLegacyAmount = p.amount !== undefined;
            const hasAmountReceived = p.amount_received !== undefined;
            return hasLegacyAmount !== hasAmountReceived;
        }
        if (p.method === PaymentMethod.QRIS || p.method === PaymentMethod.EDC) {
            return p.amount === undefined && p.amount_received === undefined;
        }
        return true;
    }

    defaultMessage(): string {
        return 'Invalid payment transport shape';
    }
}

export class CreateTransactionPaymentDto {
    @ApiProperty({
        enum: PaymentMethod,
        description:
            'Payment method. CASH accepts legacy amount or V1 amount_received; QRIS and EDC are record-only.',
    })
    @IsEnum(PaymentMethod)
    @Validate(PaymentTransportShapeConstraint)
    method: PaymentMethod;

    // Legacy RC2 CASH tender field. Kept for compatibility draining of offline queued requests.
    // Type/range validation only; semantic exclusivity is enforced in the service.
    @ApiPropertyOptional({
        type: Number,
        minimum: 0,
        description:
            'Legacy RC2 cash tender. V1 CASH clients must send amount_received instead. Mutually exclusive with amount_received.',
    })
    @ValidateIf((payment: CreateTransactionPaymentDto) => payment.amount !== undefined)
    @IsInt()
    @Min(0)
    @Max(Number.MAX_SAFE_INTEGER)
    amount?: number;

    // V1 CASH tender field. The preferred shape going forward.
    // Type/range validation only; semantic exclusivity is enforced in the service.
    @ApiPropertyOptional({
        type: Number,
        minimum: 0,
        description:
            'V1 CASH cash tender received. Mutually exclusive with legacy amount. Never treated as authoritative transaction total.',
    })
    @ValidateIf((payment: CreateTransactionPaymentDto) => payment.amount_received !== undefined)
    @IsInt()
    @Min(0)
    @Max(Number.MAX_SAFE_INTEGER)
    amount_received?: number;
}
