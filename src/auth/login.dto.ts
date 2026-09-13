import { IsEmail, IsNotEmpty, IsString, IsUUID } from "class-validator";

export class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    @IsNotEmpty()
    password: string;

    @IsUUID()
    tenant_id: string;
}