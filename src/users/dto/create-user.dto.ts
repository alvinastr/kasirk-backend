import { IsNotEmpty, IsOptional, IsString } from "class-validator";


export class CreateUserDto {

    @IsString()
    @IsNotEmpty()
    name:string;

    @IsString()
    email:string;

    @IsString()
    password:string;

    @IsString()
    role:string;

    @IsOptional()
    @IsString()
    outlet_id?:string;
}