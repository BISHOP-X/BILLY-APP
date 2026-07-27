const currencyNames: Record<string, string> = {
  NGN: 'Nigerian naira',
};

const currencyExponents: Record<string, number> = {
  NGN: 2,
};

function requireCurrencyExponent(currency: string) {
  const exponent = currencyExponents[currency];
  if (exponent === undefined) {
    throw new RangeError(`Unsupported Billy currency: ${currency}`);
  }
  return exponent;
}

function requireSafeMinorUnits(amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('Billy money amounts must be safe integer minor units');
  }

  return BigInt(amountMinor);
}

export function parseMajorUnitsToMinor(
  value: string,
  currency = 'NGN',
): number | null {
  const exponent = requireCurrencyExponent(currency);
  const normalized = value.trim().replace(/,/g, '');
  const pattern = new RegExp(`^\\d{1,13}(?:\\.\\d{0,${exponent}})?$`);
  if (!pattern.test(normalized)) return null;

  const [whole = '0', fraction = ''] = normalized.split('.');
  const scale = 10n ** BigInt(exponent);
  const minorUnits =
    BigInt(whole) * scale +
    BigInt(fraction.padEnd(exponent, '0') || '0');

  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minorUnits);
}

function formatAbsoluteMinorUnits(
  amountMinor: bigint,
  currency: string,
  exponent: number,
  symbol: boolean,
) {
  const scale = 10n ** BigInt(exponent);
  const wholeUnits = amountMinor / scale;
  const fraction = (amountMinor % scale).toString().padStart(exponent, '0');
  const formatter = new Intl.NumberFormat(
    'en-NG',
    symbol
      ? {
          currency,
          currencyDisplay: 'narrowSymbol',
          maximumFractionDigits: exponent,
          minimumFractionDigits: exponent,
          style: 'currency',
        }
      : {
          maximumFractionDigits: exponent,
          minimumFractionDigits: exponent,
        },
  );

  return formatter
    .formatToParts(Number(wholeUnits))
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('');
}

export function formatMinorUnits(
  amountMinor: number,
  currency = 'NGN',
  options?: { sign?: 'always' | 'auto'; symbol?: boolean },
) {
  const exponent = requireCurrencyExponent(currency);
  const minorUnits = requireSafeMinorUnits(amountMinor);
  const absoluteMinorUnits = minorUnits < 0n ? -minorUnits : minorUnits;
  const sign =
    minorUnits < 0n
      ? '-'
      : options?.sign === 'always' && minorUnits > 0n
        ? '+'
        : '';

  return `${sign}${formatAbsoluteMinorUnits(
    absoluteMinorUnits,
    currency,
    exponent,
    options?.symbol !== false,
  )}`;
}

export function describeMinorUnits(amountMinor: number, currency = 'NGN') {
  const exponent = requireCurrencyExponent(currency);
  const minorUnits = requireSafeMinorUnits(amountMinor);
  const absoluteMinorUnits = minorUnits < 0n ? -minorUnits : minorUnits;
  const direction = minorUnits < 0n ? 'negative ' : '';
  const currencyName = currencyNames[currency] ?? currency;
  return `${direction}${formatAbsoluteMinorUnits(
    absoluteMinorUnits,
    currency,
    exponent,
    false,
  )} ${currencyName}`;
}

export function formatActivityDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(date);
}

export function formatFullDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
