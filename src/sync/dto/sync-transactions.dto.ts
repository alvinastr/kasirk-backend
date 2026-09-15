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
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionDto)
  transactions!: CreateTransactionDto[];
}
