import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
} from 'class-validator';

export type SyncTransactionInput = Record<string, unknown>;
export type SyncTransactionKind = 'LEGACY_SYNC' | 'V1';

export class SyncTransactionsDto {
  @ApiProperty({ type: 'array', minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  transactions!: SyncTransactionInput[];
}

/**
 * Presence of the V1 discriminator selects strict V1 validation. Its value is
 * intentionally not inspected here, so malformed V1 cannot fall back to RC2.
 * Rows without the discriminator are accepted only if the narrow legacy DTO
 * validation succeeds.
 */
export function classifySyncTransaction(
  input: SyncTransactionInput,
): SyncTransactionKind {
  return Object.prototype.hasOwnProperty.call(input, 'cashier_session_id')
    ? 'V1'
    : 'LEGACY_SYNC';
}
