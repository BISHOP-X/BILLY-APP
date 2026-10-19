import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { ScalePressable } from '@/components/ui/motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { formatMinorUnits } from '@/features/wallet/money';

// Display identities only, never a provider catalog or routing map. Brand glyphs
// ship with the app so a third-party image outage cannot leave broken images.
const brands: readonly [RegExp, string, string][] = [
  [/\b(google|gmail)\b/i, 'google', '#4285F4'],
  [/\bwhatsapp\b/i, 'whatsapp', '#158347'],
  [/\btelegram\b/i, 'telegram-plane', '#229ED9'],
  [/\binstagram\b/i, 'instagram', '#D33677'],
  [/\bfacebook\b/i, 'facebook-f', '#1877F2'],
  [/\b(twitter|x)\b/i, 'twitter', '#168BD2'],
  [/\bdiscord\b/i, 'discord', '#5865F2'],
  [/\btiktok\b/i, 'tiktok', '#141820'],
  [/\bamazon\b/i, 'amazon', '#A66000'],
  [/\bspotify\b/i, 'spotify', '#13823A'],
  [/\bsnapchat\b/i, 'snapchat-ghost', '#171A18'],
  [/\blinkedin\b/i, 'linkedin-in', '#0A66C2'],
  [/\buber\b/i, 'uber', '#171A18'],
  [/\bpaypal\b/i, 'paypal', '#003087'],
  [/\bapple\b/i, 'apple', '#171A18'],
  [/\b(microsoft|outlook|azure)\b/i, 'microsoft', '#2176BC'],
  [/\bsteam\b/i, 'steam', '#17426B'],
  [/\bebay\b/i, 'ebay', '#D32F36'],
  [/\byahoo\b/i, 'yahoo', '#6001D2'],
  [/\bviber\b/i, 'viber', '#7360F2'],
  [/\blyft\b/i, 'lyft', '#E81092'],
  [/\breddit\b/i, 'reddit-alien', '#E44212'],
  [/\btwitch\b/i, 'twitch', '#8147E8'],
  [/\bairbnb\b/i, 'airbnb', '#E94B5B'],
];

export function serviceBrand(name: string) {
  const match = brands.find(([pattern]) => pattern.test(name));
  return match ? { icon: match[1], color: match[2] } : null;
}

export function ServiceAvatar(
  { name, size = 44 }: { name: string; size?: number },
) {
  const theme = useBillyTheme();
  const brand = serviceBrand(name);
  const initials = (name.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 2).map(
    (word) => word[0],
  ).join('').toUpperCase();
  return (
    <View
      accessible={false}
      style={[styles.avatar, {
        width: size,
        height: size,
        backgroundColor: brand ? '#F5F7F6' : theme.colors.brandMist,
      }]}
    >
      {brand?.icon === 'twitter'
        ? (
          <Text
            accessible={false}
            style={{ fontSize: size * 0.58, color: '#171A18' }}
          >
            𝕏
          </Text>
        )
        : brand
        ? (
          <FontAwesome5
            accessible={false}
            brand
            name={brand.icon}
            size={size * 0.52}
            color={brand.color}
          />
        )
        : (
          <Text style={[styles.initials, { color: theme.colors.brand }]}>
            {initials || 'SMS'}
          </Text>
        )}
    </View>
  );
}

export function USFlag() {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility='no-hide-descendants'
      style={styles.flag}
    >
      {Array.from(
        { length: 13 },
        (_, i) => (
          <View
            key={i}
            style={{
              height: 1.6,
              backgroundColor: i % 2 ? '#FFFFFF' : '#B22234',
            }}
          />
        ),
      )}
      <View style={styles.canton}>
        {Array.from(
          { length: 9 },
          (_, row) => (
            <View key={row} style={styles.stars}>
              {Array.from(
                { length: row % 2 ? 5 : 6 },
                (_, col) => <View key={col} style={styles.star} />,
              )}
            </View>
          ),
        )}
      </View>
    </View>
  );
}

export function NumberServiceCard(
  { name, detail, totalMinor, selected = false, disabled = false, onPress }: {
    name: string;
    detail: string;
    totalMinor: number;
    selected?: boolean;
    disabled?: boolean;
    onPress: () => void;
  },
) {
  const theme = useBillyTheme();
  const price = formatMinorUnits(totalMinor, 'NGN');
  return (
    <ScalePressable
      accessibilityRole='button'
      accessibilityLabel={`${name}, ${detail}, ${price}`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.card, {
        backgroundColor: selected
          ? theme.colors.brandMist
          : theme.colors.surface,
        borderColor: selected ? theme.colors.brand : theme.colors.border,
        opacity: disabled ? 0.55 : 1,
      }]}
    >
      <ServiceAvatar name={name} />
      <View style={styles.copy}>
        <Text style={[styles.name, { color: theme.colors.text }]}>{name}</Text>
        <Text style={[styles.detail, { color: theme.colors.textMuted }]}>
          {detail}
        </Text>
      </View>
      <View style={styles.trailing}>
        <Text
          style={[styles.price, {
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceMuted,
          }]}
        >
          {price}
        </Text>
        <Ionicons
          accessible={false}
          name={selected ? 'checkmark-circle' : 'chevron-forward'}
          size={18}
          color={selected ? theme.colors.brand : theme.colors.textSoft}
        />
      </View>
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  flag: { width: 30, height: 20.8, borderRadius: 2, overflow: 'hidden' },
  canton: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 13.5,
    height: 11.2,
    padding: 0.7,
    backgroundColor: '#3C3B6E',
    justifyContent: 'space-between',
  },
  stars: { flexDirection: 'row', justifyContent: 'space-evenly' },
  star: {
    width: 0.7,
    height: 0.7,
    borderRadius: 1,
    backgroundColor: '#FFFFFF',
  },
  avatar: {
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  initials: { fontWeight: '800', fontSize: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    gap: 12,
    minHeight: 80,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 15, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 17 },
  trailing: { alignItems: 'flex-end', gap: 6, flexShrink: 1, maxWidth: '42%' },
  price: {
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 9,
    overflow: 'hidden',
  },
});
