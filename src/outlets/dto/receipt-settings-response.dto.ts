import { ApiProperty } from '@nestjs/swagger';

export class ReceiptSettingsResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  tenant_id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  outlet_id: string;

  @ApiProperty({ type: String })
  header_store_name: string;

  @ApiProperty({ type: String })
  header_outlet_name: string;

  @ApiProperty({ type: String, nullable: true })
  header_address: string | null;

  @ApiProperty({ type: String, nullable: true })
  header_phone: string | null;

  @ApiProperty({ type: String, nullable: true })
  header_additional_text: string | null;

  @ApiProperty({ type: Boolean })
  show_sku: boolean;

  @ApiProperty({ type: Boolean })
  show_modifiers: boolean;

  @ApiProperty({ type: Boolean })
  show_item_notes: boolean;

  @ApiProperty({ type: Boolean })
  show_cashier: boolean;

  @ApiProperty({ type: Boolean })
  show_customer: boolean;

  @ApiProperty({ type: String })
  footer_thank_you_text: string;

  @ApiProperty({ type: String, nullable: true })
  footer_promo_text: string | null;

  @ApiProperty({ type: Number, enum: [1] })
  template_version: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  created_at: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updated_at: Date | null;
}
