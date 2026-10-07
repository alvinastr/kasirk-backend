import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { CreateTransactionPaymentDto } from '../../transactions/dto/create-transaction-payment.dto';

export class CheckoutHeldOrderDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expected_version: number;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  client_transaction_id: string;

  @ApiProperty({ type: () => CreateTransactionPaymentDto })
  @ValidateNested()
  @Type(() => CreateTransactionPaymentDto)
  payment: CreateTransactionPaymentDto;
}
