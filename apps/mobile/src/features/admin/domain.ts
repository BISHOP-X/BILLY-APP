export type AdminRow = Record<string, unknown>;
export type AdminPage = { rows: AdminRow[]; page: number; hasMore: boolean };
export type Pricing = {
  service_key: string;
  exchange_rate_minor_per_usd: number | null;
  markup_bps: number | null;
  version: number;
};
export type AdminSettings = {
  pricing: Pricing[];
  services: {
    service_key: string;
    label: string;
    status: string;
    status_message: string;
    enabled: boolean;
    rollout_mode: string;
    requires_kyc: boolean;
  }[];
  readyServices: Record<string, boolean>;
};

/** Exact decimal input, not floating arithmetic, for NGN rates and percentages. */
export function parseTwoDecimals(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
export function inputTwoDecimals(value: number | null): string {
  return value === null
    ? ''
    : `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}
export function adminMoney(value: unknown): string {
  if (!/^-?\d+$/.test(String(value ?? ''))) return '—';
  const minor = BigInt(String(value));
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? '-' : ''}₦${(absolute / 100n).toLocaleString('en-NG')}.${String(absolute % 100n).padStart(2, '0')}`;
}
export const adminSections = [
  ['overview', 'Overview', 'grid-outline'],
  ['transactions', 'Transactions', 'swap-horizontal-outline'],
  ['users', 'Customers', 'people-outline'],
  ['numbers', 'SMS orders', 'chatbubbles-outline'],
  ['social', 'Social orders', 'megaphone-outline'],
  ['catalog', 'Social catalogue', 'layers-outline'],
  ['funding', 'Funding accounts', 'wallet-outline'],
  ['kyc', 'Identity checks', 'shield-checkmark-outline'],
  ['support', 'Support cases', 'help-buoy-outline'],
  ['settings', 'Pricing & controls', 'options-outline'],
  ['audit', 'Audit trail', 'document-text-outline'],
] as const;
export type AdminSection = (typeof adminSections)[number][0];
