// Owner-approved INTERNAL TEST fixture (14 Nov 2026). Not provider evidence.
// Enabled only by BILLY_INTERNAL_TEST_CARRIERS=true on the server. Remove this
// switch before public launch. Never persist these into provider receipts.
const carriers: Record<string, string[]> = {
  US: ['T-Mobile', 'AT&T', 'Verizon'], CA: ['Rogers', 'Bell', 'Telus'],
  GB: ['Three', 'EE', 'Vodafone', 'O2'], AU: ['Pivotel', 'Telstra', 'Optus'],
  HK: ['Hutchison', 'CSL', 'SmarTone'], ID: ['XLSMART', 'Telkomsel', 'Indosat'],
  AR: ['Claro', 'Movistar', 'Personal'], BR: ['Vivo', 'Claro', 'TIM'],
  CL: ['Entel', 'Movistar', 'Claro'], CO: ['Claro', 'Movistar', 'Tigo'],
  PH: ['Globe', 'Smart', 'DITO'], TR: ['Turkcell', 'Vodafone', 'Turk Telekom'],
  ZA: ['Vodacom', 'MTN', 'Telkom'],
};
export function internalTestCarrier(country: string, number: string) {
  const options = carriers[country];
  if (!options?.length) return null;
  let hash = 0;
  for (const c of number) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
  return options[hash % options.length];
}
