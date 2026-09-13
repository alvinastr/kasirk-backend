import { IsInt, IsString, IsUUID } from "class-validator";

export class CreateStockAdjustmentDto {

    @IsUUID()
    outlet_id:string;

    @IsUUID()
    product_id:string;

    @IsString()
    adjustment_type:string;

    @IsInt()
    quantity:number;

    @IsString()
    reason:string;
}