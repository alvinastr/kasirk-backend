import { ApiProperty } from '@nestjs/swagger';

/**
 * M16G-0A: runtime shape of the `POST /held-orders/:id/checkout` success body.
 * The class below is the Swagger/OpenAPI description of this same shape.
 */
export interface CheckoutHeldOrderResult {
  /** Canonical transaction detail, byte-identical to the POST /transactions response. */
  transaction: Record<string, unknown>;
  /** false = this request performed the OPEN -> CONVERTED transition; true = validated idempotent replay. */
  replayed: boolean;
}

/**
 * M16G-0A: success envelope for `POST /held-orders/:id/checkout`.
 *
 * The canonical transaction payload is produced by
 * `TransactionsService.executeTransactionCore` -> `TransactionsService.checkout`
 * -> `toResponse`, which is the single mapping used by the normal
 * `POST /transactions` endpoint. This envelope deliberately does not restate
 * or re-map those fields: it only carries the server-authoritative statement of
 * whether THIS request performed the OPEN -> CONVERTED transition.
 *
 * `replayed` is never derived from client input. It comes from the branch the
 * conversion actually took inside the Serializable transaction:
 * - `false` -> the claim CAS succeeded, the sale core created a new transaction,
 *   and the terminal `CONVERTED` update committed in this same transaction.
 * - `true`  -> the held order was already `CONVERTED`; the linked transaction was
 *   validated, `client_transaction_id` matched, and the payload/payment equality
 *   check passed, so the canonical linked transaction is returned unchanged.
 *
 * Errors are never wrapped. Every failure (`HELD_ORDER_VERSION_CONFLICT`,
 * `HELD_ORDER_NOT_OPEN`, `HELD_ORDER_CONVERTED_NO_LINK`,
 * `HELD_ORDER_LINK_MISMATCH`, `IDEMPOTENCY_PAYLOAD_MISMATCH`,
 * `TRANSACTION_RETRY_REQUIRED`, stock/session/outlet/catalog/modifier errors)
 * still throws before this object is constructed.
 */
export class CheckoutHeldOrderResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Canonical transaction detail, identical in shape and content to the POST /transactions response.',
  })
  transaction: Record<string, unknown>;

  @ApiProperty({
    type: Boolean,
    description:
      'false when this request performed the held-order conversion; true when this request returned an already-converted linked transaction via the validated idempotent replay path.',
    example: false,
  })
  replayed: boolean;
}