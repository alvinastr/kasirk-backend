import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayUnique,
    IsArray,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    ValidateIf,
} from 'class-validator';

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

    // Omitted or [] means no selection; explicit null is rejected.
    @ApiPropertyOptional({
        type: [String],
        format: 'uuid',
        description: 'Selected modifier option identifiers. Omit when the product takes no modifier.',
        default: [],
    })
    @ValidateIf((_item: unknown, value: unknown) => value !== undefined)
    @IsArray()
    @ArrayMaxSize(50)
    @ArrayUnique((value: unknown) => (typeof value === 'string' ? value.toLowerCase() : value), {
        message: 'modifier_option_ids must not contain duplicate values',
    })
    @IsUUID('4', { each: true })
    modifier_option_ids?: string[];

    // Informational line note. Omission persists null; explicit null is rejected.
    @ApiPropertyOptional({
        type: String,
        maxLength: 255,
        nullable: false,
        description: 'Optional item note such as a kitchen or customer instruction.',
    })
    @ValidateIf((_item: unknown, value: unknown) => value !== undefined)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MaxLength(255)
    note?: string;
}
