import { IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateProductDto {

    @IsString()
    name: string;

    @IsString()
    sku: string;

    @IsNumber()
    @Min(0)
    price: number;

    @IsNumber()
    @Min(0)
    cost: number

    @IsNumber()
    @Min(0)
    minimum_stock: number;

    @IsOptional()
    @IsString()
    category_id?: string;
}