import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateCustomerDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ValidateIf(
    (_object: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone?: string | null;

  @ValidateIf(
    (_object: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @IsEmail()
  @MaxLength(255)
  email?: string | null;
}
