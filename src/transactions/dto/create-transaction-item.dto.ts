import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class CreateTransactionItemDto {
    @IsUUID()
    product_id: string;

    @IsInt()
    @Min(1)
    @Max(2147483647)
    quantity: number;
}
