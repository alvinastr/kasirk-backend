import { IsOptional, IsString } from "class-validator";

export class CreateOutletDto {

    @IsString()
    name:string;

    @IsOptional()
    @IsString()
    address?:string;
}