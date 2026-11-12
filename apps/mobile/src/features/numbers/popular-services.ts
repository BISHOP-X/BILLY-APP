// Billy's curated display order, not provider stock or measured usage rankings.
// Only matching, available catalogue rows are promoted; nothing is synthesized.
export const POPULAR_SMS_SERVICES = [
  'WhatsApp', 'Instagram', 'Facebook', 'Telegram', 'Google (Gmail)',
  'TikTok', 'X', 'Snapchat', 'Discord', 'Microsoft',
  'Apple', 'Amazon', 'PayPal', 'Netflix', 'YouTube',
  'Tinder', 'Bumble', 'Hinge', 'Uber', 'Airbnb',
  'LinkedIn', 'Reddit', 'Signal', 'Viber', 'WeChat',
  'LINE', 'Yahoo', 'Proton', 'Steam', 'Sony',
  'Twitch', 'OpenAI/ChatGPT', 'AliExpress', 'Temu', 'SHEIN',
  'Walmart', 'eBay', 'DoorDash', 'Bolt', 'Lyft',
  'Binance', 'Coinbase', 'Cash App', 'Venmo', 'Revolut',
  'Wise', 'Skrill', 'Booking.com', 'Fiverr', 'Upwork',
] as const;

const normalize = (name: string) => name.trim().toLowerCase();
const ranks = new Map<string, number>(
  POPULAR_SMS_SERVICES.map((name, index) => [normalize(name), index]),
);

export function popularSmsRank(name: string) {
  return ranks.get(normalize(name)) ?? Number.POSITIVE_INFINITY;
}

export function compareSmsServices(a: { name: string }, b: { name: string }) {
  const first = popularSmsRank(a.name), second = popularSmsRank(b.name);
  if (first !== second) return first < second ? -1 : 1;
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
}
