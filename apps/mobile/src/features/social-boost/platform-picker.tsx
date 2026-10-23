import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ScalePressable } from '@/components/ui/motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { typography } from '@/theme/tokens';
import type { SocialBoostPlatform } from './domain';

// Brand presentation only; available platforms always come from the live catalogue.
const brands: Record<SocialBoostPlatform, { label: string; icon: string; color: string }> = {
  instagram: { label: 'Instagram', icon: 'instagram', color: '#D33677' },
  facebook: { label: 'Facebook', icon: 'facebook', color: '#1877F2' },
  youtube: { label: 'YouTube', icon: 'youtube', color: '#FF0033' },
  telegram: { label: 'Telegram', icon: 'telegram-plane', color: '#229ED9' },
  tiktok: { label: 'TikTok', icon: 'tiktok', color: '#151515' },
  twitter: { label: 'X', icon: '', color: '#151515' },
  twitch: { label: 'Twitch', icon: 'twitch', color: '#9146FF' },
  spotify: { label: 'Spotify', icon: 'spotify', color: '#1DB954' },
  discord: { label: 'Discord', icon: 'discord', color: '#5865F2' },
  snapchat: { label: 'Snapchat', icon: 'snapchat-ghost', color: '#151515' },
  linkedin: { label: 'LinkedIn', icon: 'linkedin', color: '#0A66C2' },
  pinterest: { label: 'Pinterest', icon: 'pinterest', color: '#E60023' },
  soundcloud: { label: 'SoundCloud', icon: 'soundcloud', color: '#FF5500' },
  threads: { label: 'Threads', icon: '', color: '#151515' },
  other: { label: 'Other', icon: '', color: '#146237' },
};

export function BoostPlatformIcon({ platform, size = 24 }: { platform: string; size?: number }) {
  const brand = brands[platform as SocialBoostPlatform];
  if (platform === 'twitter' || platform === 'threads') return <FontAwesome6 accessible={false} iconStyle="brand" name={platform === 'twitter' ? 'x-twitter' : 'threads'} color="#151515" size={size} />;
  if (!brand?.icon) return <Ionicons accessible={false} name={platform === 'all' ? 'list' : 'globe-outline'} color="#146237" size={size} />;
  return <FontAwesome5 accessible={false} brand name={brand.icon} color={brand.color} size={size} />;
}

export function BoostPlatformPicker({ platforms, selected, onSelect }: {
  platforms: SocialBoostPlatform[]; selected: string; onSelect: (platform: string) => void;
}) {
  const theme = useBillyTheme();
  const { width } = useWindowDimensions();
  const available = ['all', ...Object.keys(brands).filter((key) => platforms.includes(key as SocialBoostPlatform))];
  return <View style={styles.grid}>
    {available.map((platform) => {
      const active = selected === platform;
      const label = platform === 'all' ? 'All' : brands[platform as SocialBoostPlatform].label;
      return <View key={platform} style={styles.cell}>
        <ScalePressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={() => onSelect(platform)} style={[styles.tile, {
          backgroundColor: active ? theme.colors.brandMist : theme.colors.surfaceMuted,
          borderColor: active ? theme.colors.brand : theme.colors.border,
        }]}>
          <View style={[styles.icon, platform === 'snapchat' && { backgroundColor: '#FFFC00' }]}><BoostPlatformIcon platform={platform} /></View>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.label, { color: theme.colors.text }, width < 360 && { fontSize: 9 }]}>{label}</Text>
          {active ? <Ionicons style={styles.check} color={theme.colors.brand} name="checkmark-circle" size={14} /> : null}
        </ScalePressable>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, rowGap: 8 },
  cell: { width: '25%', paddingHorizontal: 4 },
  tile: { borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 78, gap: 5, padding: 6 },
  icon: { backgroundColor: '#FFFFFF', borderRadius: 10, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: typography.family, fontSize: 10, fontWeight: '600' },
  check: { position: 'absolute', right: 4, top: 4 },
});
