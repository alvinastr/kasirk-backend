/**
 * M16B: shared pure tax helper.
 *
 * Both TransactionsService (authoritative sale) and HeldOrdersService (estimates)
 * must compute tax identically. This function guarantees byte-for-byte parity.
 *
 * Input contract:
 *  - `taxEnabled: boolean`
 *  - `taxRate: unknown` — exactly as returned by Prisma for Decimal(5,2):
 *    either a `Decimal` instance (with `.toFixed()`) or a JS number.
 *
 * Returns:
 *  - `tax: bigint` — rounded half-up to nearest integer (0.5 → 1)
 *  - `total: bigint` — `taxableAmount + tax`
 *
 * Formula: `tax = (taxableAmount * basisPoints + 5000n) / 10000n`
 *   where `basisPoints = taxRate * 100` (e.g. 11.00% → 1100).
 *
 * Matches the pre-M16B TransactionsService line:
 *   `const rate = BigInt(tenant.tax_rate.toFixed(2).replace('.', ''));`
 *   `const tax = (taxableAmount * rate + 5000n) / 10000n;`
 *
 * And HeldOrdersService line:
 *   `const scaledRate = this.scaledTaxRate(tenant.tax_rate);`
 *   `const tax = (subtotal * scaledRate + 5000n) / 10000n;`
 *
 * The only numeric difference can be how `Decimal(5,2)` is materialized:
 * - `toFixed(2)` on `Decimal` produces "11.00" → "1100" → 1100n
 * - `Number(Decimal)` → 11 → * 100 → 1100
 * Both yield the same basis-point integer. Using `toFixed` from Decimal
 * is the authoritative path; the fallback covers `number` test doubles.
 */
export function calculateTax(
    taxEnabled: boolean,
    taxRate: unknown,
    taxableAmount: bigint,
): { tax: bigint; total: bigint } {
    if (!taxEnabled) {
        return { tax: 0n, total: taxableAmount };
    }

    const decimal = (taxRate as { toFixed?: (places: number) => string })?.toFixed;
    let basisPoints: bigint;
    if (typeof decimal === 'function') {
        basisPoints = BigInt(decimal.call(taxRate, 2).replace('.', ''));
    } else {
        basisPoints = BigInt(Math.round(Number(taxRate) * 100));
    }

    const tax = (taxableAmount * basisPoints + 5000n) / 10000n;
    return { tax, total: taxableAmount + tax };
}