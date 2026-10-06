import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { calculateTax } from './tax.util';

/**
 * M16B: proves the shared tax helper is numerically identical to BOTH original
 * inline implementations before they are replaced.
 *
 * `legacyTransactionTax` is a verbatim copy of the pre-refactor
 * TransactionsService line (trusted only by the `Decimal` code path, exactly as
 * before the refactor).
 *
 * `legacyHeldOrderTax` is a verbatim copy of the pre-refactor
 * HeldOrdersService `scaledTaxRate` + rounding line.
 */

function legacyTransactionTax(taxRate: { toFixed(places: number): string }, taxableAmount: bigint, enabled: boolean) {
    const rate = BigInt(taxRate.toFixed(2).replace('.', ''));
    return enabled ? (taxableAmount * rate + 5000n) / 10000n : 0n;
}

function legacyHeldOrderTax(taxRate: unknown, taxableAmount: bigint, enabled: boolean) {
    const decimal = (taxRate as { toFixed?: (places: number) => string })?.toFixed;
    const scaledRate = typeof decimal === 'function'
        ? BigInt(decimal.call(taxRate, 2).replace('.', ''))
        : BigInt(Math.round(Number(taxRate) * 100));
    return enabled ? (taxableAmount * scaledRate + 5000n) / 10000n : 0n;
}

/** Minimal stand-in for Prisma's Decimal with `.toFixed()`. */
function decimalOf(value: string): { toFixed(places: number): string } {
    return { toFixed: (places: number) => Number(value).toFixed(places) };
}

const RATES = ['0', '0.5', '1', '5', '10', '11', '11.5', '16', '20', '33.33', '99.99'];
const AMOUNTS = [0n, 1n, 2n, 5n, 99n, 100n, 101n, 300n, 999n, 1000n, 12345n, 999999n, 123456789n];

describe('common/utils/tax.util M16B shared tax parity', () => {
    it('matches the legacy TransactionsService Decimal path for every rate/amount pair', () => {
        for (const rate of RATES) {
            for (const amount of AMOUNTS) {
                for (const enabled of [true, false]) {
                    const expected = legacyTransactionTax(decimalOf(rate), amount, enabled);
                    const actual = calculateTax(enabled, decimalOf(rate), amount).tax;
                    expect({ rate, amount: amount.toString(), enabled, actual: actual.toString() })
                        .toEqual({ rate, amount: amount.toString(), enabled, actual: expected.toString() });
                }
            }
        }
    });

    it('matches the legacy HeldOrdersService scaledTaxRate path for every rate/amount pair', () => {
        for (const rate of RATES) {
            for (const amount of AMOUNTS) {
                for (const enabled of [true, false]) {
                    const expected = legacyHeldOrderTax(decimalOf(rate), amount, enabled);
                    const actual = calculateTax(enabled, decimalOf(rate), amount).tax;
                    expect({ rate, amount: amount.toString(), enabled, actual: actual.toString() })
                        .toEqual({ rate, amount: amount.toString(), enabled, actual: expected.toString() });
                }
            }
        }
    });

    it('matches the legacy number fallback path (test doubles) for every rate/amount pair', () => {
        for (const rate of RATES) {
            for (const amount of AMOUNTS) {
                const expected = legacyHeldOrderTax(Number(rate), amount, true);
                const actual = calculateTax(true, Number(rate), amount).tax;
                expect({ rate, amount: amount.toString(), actual: actual.toString() })
                    .toEqual({ rate, amount: amount.toString(), actual: expected.toString() });
            }
        }
    });

    it('rounds half-up at the exact .5 boundary', () => {
        // 5% = 500bp. taxable 5  ->  5*500 =  2500 -> (2500+5000)/10000 = 0.75 -> 0
        expect(calculateTax(true, decimalOf('5'), 5n).tax).toBe(0n);
        // 5% = 500bp. taxable 10 -> 10*500 =  5000 -> (5000+5000)/10000 = 1.0  -> 1
        expect(calculateTax(true, decimalOf('5'), 10n).tax).toBe(1n);
        // 5% = 500bp. taxable 30 -> 30*500 = 15000 -> (15000+5000)/10000 = 2.0 -> 2
        expect(calculateTax(true, decimalOf('5'), 30n).tax).toBe(2n);
        // 5% = 500bp. taxable 50 -> 50*500 = 25000 -> 3.0 -> 3
        expect(calculateTax(true, decimalOf('5'), 50n).tax).toBe(3n);
        // Exact .5 case that must round UP: 3% = 300bp, taxable 50
        //   -> 50*300 = 15000 -> (15000+5000)/10000 = 2.0 -> 2
        expect(calculateTax(true, decimalOf('3'), 50n).tax).toBe(2n);
        // 1% = 100bp, taxable 50 -> 50*100 = 5000 -> (5000+5000)/10000 = 1.0 -> 1
        expect(calculateTax(true, decimalOf('1'), 50n).tax).toBe(1n);
        // Sanity: 11% = 1100bp, taxable 300 -> 330000 -> (330000+5000)/10000 = 33.5 -> 33
        //   (matches the M16A held-order fixture expectation of 33n)
        expect(calculateTax(true, decimalOf('11'), 300n).tax).toBe(33n);
    });

    it('returns tax 0 and unchanged total when tax is disabled', () => {
        const result = calculateTax(false, decimalOf('11'), 300n);
        expect(result).toEqual({ tax: 0n, total: 300n });
    });

    it('returns tax 0 and unchanged total for a zero taxable amount', () => {
        expect(calculateTax(true, decimalOf('11'), 0n)).toEqual({ tax: 0n, total: 0n });
    });

    it('preserves the legacy formula exactly for a negative taxable amount', () => {
        // Legacy code has no guard here; it computed the rounded value directly.
        // The shared helper must NOT silently change this, so the negative case
        // is asserted against the verbatim legacy formula, not a "nice" answer.
        const expectedTax = legacyHeldOrderTax(decimalOf('11'), -100n, true);
        const actual = calculateTax(true, decimalOf('11'), -100n);
        expect(actual).toEqual({ tax: expectedTax, total: -100n + expectedTax });
    });

    it('produces total = taxable + tax exactly', () => {
        for (const rate of RATES) {
            for (const amount of AMOUNTS) {
                const { tax, total } = calculateTax(true, decimalOf(rate), amount);
                expect({ rate, amount: amount.toString(), sum: (amount + tax).toString(), total: total.toString() })
                    .toEqual({ rate, amount: amount.toString(), sum: total.toString(), total: total.toString() });
            }
        }
    });
});