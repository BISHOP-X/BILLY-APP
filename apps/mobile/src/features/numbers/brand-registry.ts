import { brandArtwork } from './brand-artwork';
import { additionalArtwork } from './generated-brand-artwork';
import { brandRasters } from './brand-rasters';

const artwork: typeof brandArtwork = {...brandArtwork,...additionalArtwork};

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
  bitcoin:['bitcoin','btc'],ethereum:['ethereum','eth'],tether:['tether','usdt'],solana:['solana','sol'],litecoin:['litecoin','ltc'],
  dogecoin:['dogecoin','doge'],cardano:['cardano','ada'],xrp:['xrp','ripple'],tron:['tron','trx'],usdcoin:['usd coin','usdc'],
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
  ...Object.entries(artwork).flatMap(([slug, item]) =>
    (aliases[slug] ?? [item.label, slug]).map(alias => ({ slug, words: normalize(alias) }))),
  ...Object.entries(legacy).flatMap(([slug, item]) =>
    item.aliases.map(alias => ({ slug, words: normalize(alias) }))),
].sort((a, b) => b.words.length - a.words.length);
const rasterMatchers=Object.entries(brandRasters).flatMap(([slug,item])=>item.aliases.flatMap(alias=>[alias,alias.split(/\s+\/\s+/)[0]]).map(alias=>({slug,words:normalize(alias)})))
  .sort((a,b)=>b.words.length-a.words.length);

type ServiceBrand={icon:string;label:string;color:string;uri?:string;asset?:number};

export function serviceBrand(name: string):ServiceBrand|null {
  const normalized = ' ' + normalize(name) + ' ';
  const match = matchers.find(({ words }) => normalized.includes(' ' + words + ' '));
  const rasterMatch=rasterMatchers.find(({words})=>normalized.includes(' '+words+' '));
  if(rasterMatch){const raster=brandRasters[rasterMatch.slug];return {icon:match?.slug??rasterMatch.slug,label:raster.label,color:'#15231B',asset:raster.asset};}
  if (!match) return null;
  const asset = artwork[match.slug];
  if (asset) return {
    icon: match.slug, label: asset.label, color: asset.color,
    uri: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="' +
      asset.color + '" d="' + asset.path + '"/></svg>'),
  };
  return { ...legacy[match.slug], uri: undefined };
}

export function serviceFallbackIcon(name:string):'phone-portrait-outline'|'chatbubbles-outline'|'wallet-outline'|'heart-outline'|'game-controller-outline'|'bag-handle-outline'|'apps-outline'{
  const value=normalize(name);
  if(/rental|generic|not listed|number/.test(value))return 'phone-portrait-outline';
  if(/survey|opinion|reward|cash|money|pay|coin|earn/.test(value))return 'wallet-outline';
  if(/dating|match|meet|love/.test(value))return 'heart-outline';
  if(/game|play|pack|rips/.test(value))return 'game-controller-outline';
  if(/shop|store|gift|buy/.test(value))return 'bag-handle-outline';
  if(/chat|sms|text|mail/.test(value))return 'chatbubbles-outline';
  return 'apps-outline';
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
