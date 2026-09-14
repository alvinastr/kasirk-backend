import { IsIn, IsInt, IsString, IsUUID, Matches, Min } from 'class-validator';

export class CreateStockAdjustmentDto {
    @IsUUID()
    outlet_id: string;

    @IsUUID()
    product_id: string;

    @IsIn(['ADD', 'DEDUCT'])
    adjustment_type: 'ADD' | 'DEDUCT';

    @IsInt()
    @Min(1)
    quantity: number;

    @IsString()
    @Matches(/\S/, { message: 'reason must not be blank' })
    reason: string;
}
