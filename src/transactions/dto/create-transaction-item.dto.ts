import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class CreateTransactionItemDto {
    @ApiProperty({
        type: String,
        format: 'uuid',
        description: 'Product identifier.',
    })
    @IsUUID()
    product_id: string;

    @ApiProperty({
        type: Number,
        minimum: 1,
        maximum: 2147483647,
        description: 'Item quantity.',
    })
    @IsInt()
    @Min(1)
    @Max(2147483647)
    quantity: number;
}
