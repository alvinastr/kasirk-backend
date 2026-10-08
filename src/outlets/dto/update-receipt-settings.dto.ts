import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateReceiptSettingsDto {
  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(trimText)
  @IsDefined()
  @IsString()
  @Matches(/\S/, { message: 'header_store_name must not be blank' })
  @MaxLength(100)
  header_store_name: string;

  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(trimText)
  @IsDefined()
  @IsString()
  @Matches(/\S/, { message: 'header_outlet_name must not be blank' })
  @MaxLength(100)
  header_outlet_name: string;

  @ApiProperty({ type: String, maxLength: 500, nullable: true })
  @Transform(trimText)
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(/\S/, { message: 'header_address must not be blank' })
  @MaxLength(500)
  header_address: string | null;

  @ApiProperty({ type: String, maxLength: 30, nullable: true })
  @Transform(trimText)
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(/\S/, { message: 'header_phone must not be blank' })
  @MaxLength(30)
  header_phone: string | null;

  @ApiProperty({ type: String, maxLength: 500, nullable: true })
  @Transform(trimText)
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(/\S/, { message: 'header_additional_text must not be blank' })
  @MaxLength(500)
  header_additional_text: string | null;

  @ApiProperty({ type: Boolean })
  @IsDefined()
  @IsBoolean()
  show_sku: boolean;

  @ApiProperty({ type: Boolean })
  @IsDefined()
  @IsBoolean()
  show_modifiers: boolean;

  @ApiProperty({ type: Boolean })
  @IsDefined()
  @IsBoolean()
  show_item_notes: boolean;

  @ApiProperty({ type: Boolean })
  @IsDefined()
  @IsBoolean()
  show_cashier: boolean;

  @ApiProperty({ type: Boolean })
  @IsDefined()
  @IsBoolean()
  show_customer: boolean;

  @ApiProperty({ type: String, maxLength: 200 })
  @Transform(trimText)
  @IsDefined()
  @IsString()
  @Matches(/\S/, { message: 'footer_thank_you_text must not be blank' })
  @MaxLength(200)
  footer_thank_you_text: string;

  @ApiProperty({ type: String, maxLength: 500, nullable: true })
  @Transform(trimText)
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(/\S/, { message: 'footer_promo_text must not be blank' })
  @MaxLength(500)
  footer_promo_text: string | null;
}
