import {
  describeMinorUnits,
  formatMinorUnits,
} from '@/features/wallet/money';

describe('minor-unit money formatting', () => {
  it('formats integer kobo as NGN without floating-point arithmetic', () => {
    expect(formatMinorUnits(2_548_500)).toBe('₦25,485.00');
    expect(formatMinorUnits(1, 'NGN', { symbol: false })).toBe('0.01');
    expect(formatMinorUnits(125_000, 'NGN', { sign: 'always' })).toBe(
      '+₦1,250.00',
    );
  });

  it('produces explicit accessible descriptions for positive and negative values', () => {
    expect(describeMinorUnits(2_548_500)).toBe(
      '25,485.00 Nigerian naira',
    );
    expect(describeMinorUnits(-10_000)).toBe(
      'negative 100.00 Nigerian naira',
    );
  });

  it('formats the maximum schema-valid amount without losing kobo', () => {
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER)).toBe(
      '₦90,071,992,547,409.91',
    );
    expect(describeMinorUnits(Number.MAX_SAFE_INTEGER)).toBe(
      '90,071,992,547,409.91 Nigerian naira',
    );
  });

  it('preserves exact near-boundary kobo values', () => {
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER - 1)).toBe(
      '₦90,071,992,547,409.90',
    );
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER - 2)).toBe(
      '₦90,071,992,547,409.89',
    );
  });

  it('formats negative boundary values exactly', () => {
    expect(formatMinorUnits(-Number.MAX_SAFE_INTEGER)).toBe(
      '-₦90,071,992,547,409.91',
    );
    expect(
      formatMinorUnits(-Number.MAX_SAFE_INTEGER, 'NGN', { symbol: false }),
    ).toBe('-90,071,992,547,409.91');
    expect(describeMinorUnits(-Number.MAX_SAFE_INTEGER)).toBe(
      'negative 90,071,992,547,409.91 Nigerian naira',
    );
  });

  it('fails closed for unsupported currencies and invalid minor units', () => {
    expect(() => formatMinorUnits(100, 'NOT_A_CURRENCY')).toThrow(RangeError);
    expect(() => formatMinorUnits(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
    expect(() => formatMinorUnits(1.5)).toThrow(RangeError);
  });
});
