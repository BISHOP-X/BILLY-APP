import { brandArtwork } from './brand-artwork';

const aliases: Record<string, string[]> = {
  google: ['google / gmail / youtube', 'google voice', 'google'], gmail: ['gmail', 'g mail'],
  apple: ['apple id', 'apple', 'icloud'],
  facebook: ['facebook', 'fb'], instagram: ['instagram', 'insta', 'ig'],
  x: ['twitter', 'x'], tiktok: ['tik tok', 'tiktok'],
  whatsapp: ['whats app', 'whatsapp'], telegram: ['telegram', 'tg'],
  cashapp: ['cash app', 'cashapp'], paypal: ['pay pal', 'paypal'],
  protonmail: ['proton mail', 'protonmail'], proton: ['proton'],
  ubereats: ['uber eats', 'ubereats'], uber: ['uber'],
  bookingdotcom: ['booking.com', 'booking'],
  tripdotcom: ['trip.com'], ebay: ['e bay', 'ebay'],
  riotgames: ['riot games', 'riot', 'valorant', 'league of legends'],
  epicgames: ['epic games', 'epicgames'],
  playstation: ['playstation', 'psn'], ea: ['electronic arts', 'ea'],
  wechat: ['wechat', 'weixin'], vk: ['vkontakte', 'vk'],
  line: ['line'], steam: ['steam'], claude: ['claude'],
};
const legacy: Record<string, { label: string; color: string; icon: string; aliases: string[] }> = {
  microsoft: { label: 'Microsoft', color: '#0078D4', icon: 'microsoft', aliases: ['microsoft', 'outlook', 'hotmail', 'azure', 'office 365', 'xbox'] },
  amazon: { label: 'Amazon', color: '#A66000', icon: 'amazon', aliases: ['amazon', 'aws'] },
  yahoo: { label: 'Yahoo', color: '#6001D2', icon: 'yahoo', aliases: ['yahoo'] },
  linkedin: { label: 'LinkedIn', color: '#0A66C2', icon: 'linkedin-in', aliases: ['linkedin', 'linked in'] },
};
function normalize(name: string) {
  return name.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const matchers = [
  ...Object.entries(brandArtwork).flatMap(([slug, item]) =>
    (aliases[slug] ?? [item.label, slug]).map(alias => ({ slug, words: normalize(alias) }))),
  ...Object.entries(legacy).flatMap(([slug, item]) =>
    item.aliases.map(alias => ({ slug, words: normalize(alias) }))),
].sort((a, b) => b.words.length - a.words.length);

export function serviceBrand(name: string) {
  const normalized = ' ' + normalize(name) + ' ';
  const match = matchers.find(({ words }) => normalized.includes(' ' + words + ' '));
  if (!match) return null;
  const asset = brandArtwork[match.slug];
  if (asset) return {
    icon: match.slug, label: asset.label, color: asset.color,
    uri: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="' +
      asset.color + '" d="' + asset.path + '"/></svg>'),
  };
  return { ...legacy[match.slug], uri: undefined };
}

const palette = ['#305C95', '#744AA1', '#99602F', '#A23D60', '#147878', '#6554A4'];
export function brandTileBackground(color: string) {
  const channels = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return 1.05 / (luminance + 0.05) < 3 ? '#15231B' : '#FFFFFF';
}
export function serviceInitials(name: string) {
  const words = normalize(name).split(' ').filter(word =>
    !['sms', 'verification', 'verify', 'number', 'numbers', 'cheap', 'rental'].includes(word));
  const normalized = words.join(' ');
  let hash = 0;
  for (const char of normalized) hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0;
  return {
    initials: words.slice(0, 2).map(word => [...word][0]).join('').toUpperCase() || 'SMS',
    color: palette[hash % palette.length],
  };
}
