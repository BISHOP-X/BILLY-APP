import {
  type CountryCode,
  parsePhoneNumberFromString,
} from 'npm:libphonenumber-js@1.13.16/max';

/** Country inference is numbering-plan metadata, never a guessed carrier-prefix table. */
export function internationalPhone(input: string, country?: string) {
  const clean = input.trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (!/^\+[1-9]\d{6,14}$/.test(clean)) {
    throw new Error(
      'Include your country code, for example +234 803 123 4567.',
    );
  }
  const parsed = parsePhoneNumberFromString(clean, { extract: false });
  if (!parsed || !parsed.isPossible() || parsed.isNonGeographic()) {
    throw new Error('Check the phone number and country code, then try again.');
  }
  const candidates = parsed.country
    ? [parsed.country]
    : parsed.getPossibleCountries();
  if (country && !candidates.includes(country as CountryCode)) {
    throw new Error(
      'This phone number does not match the selected country. Check its country code.',
    );
  }
  return {
    number: parsed.number as string,
    nationalNumber: parsed.nationalNumber as string,
    formatted: parsed.formatInternational(),
    country: country || parsed.country || '',
    candidates: candidates as string[],
  };
}
