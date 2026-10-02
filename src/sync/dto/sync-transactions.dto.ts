import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { CreateTransactionDto } from '../../transactions/dto/create-transaction.dto';

export class SyncTransactionsDto {
  @ApiProperty({
    type: () => [CreateTransactionDto],
    minItems: 1,
    maxItems: 100,
    description: 'Array of transactions to sync.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionDto)
  transactions!: CreateTransactionDto[];
}
