import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/button';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { typography } from '@/theme/tokens';
import type { SocialBoostService } from './domain';
import { BoostPlatformIcon } from './platform-picker';
import { boostServicePrice } from './price-label';

// Filter the cached catalogue locally, but only mount a small visible result window.
export function BoostSearchResults({ searchKey, services, loading, total, error, onRetry, onSelect, onLoadMore, loadingMore, loadError }: {
  searchKey: string;
  services: SocialBoostService[]; loading: boolean; total?: number; error?: string;
  onRetry: () => void; onSelect: (service: SocialBoostService) => void;
  onLoadMore?: () => void; loadingMore?: boolean; loadError?: boolean;
}) {
  const theme = useBillyTheme();
  const [window, setWindow] = useState({ searchKey, size: 8 });
  const visible = window.searchKey === searchKey ? window.size : 8;
  const moreLocal = visible < services.length;
  return <View style={styles.results} testID="boost-search-results">
    <View style={styles.heading} accessibilityLiveRegion="polite">
      <Text style={[styles.caption, { color: theme.colors.textMuted }]}>
        {loading ? 'Finding services…' : error ? 'Could not finish searching' : `${total ?? services.length} matching ${(total ?? services.length) === 1 ? 'service' : 'services'}`}
      </Text>
      {loading ? <ActivityIndicator size="small" color={theme.colors.brand} accessibilityLabel="Searching services" /> : null}
    </View>
    {services.slice(0, visible).map((service) => <Pressable key={service.selectionToken}
      accessibilityRole="button" accessibilityLabel={`Select ${service.name}, ${service.category}`}
      onPress={() => onSelect(service)}
      style={({ pressed }) => [styles.result, { borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.brandMist : theme.colors.surfaceMuted }]}>
      <View style={styles.icon}><BoostPlatformIcon platform={service.platform} size={20} /></View>
      <View style={styles.copy}>
        <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={2}>{service.name}</Text>
        <Text style={[styles.caption, { color: theme.colors.textMuted }]} numberOfLines={1}>{service.category}</Text>
        <Text style={[styles.price, { color: theme.colors.brand }]}>{boostServicePrice(service)}</Text>
      </View>
      <Ionicons name="chevron-forward" color={theme.colors.textMuted} size={16} />
    </Pressable>)}
    {!services.length && !loading && !error ? <Text style={[styles.empty, { color: theme.colors.textMuted }]}>No matching services. Try a different name or platform.</Text> : null}
    {error ? <AppButton label="Retry search" variant="ghost" onPress={onRetry} /> : null}
    {moreLocal || onLoadMore ? <AppButton label={loadError ? 'Retry loading services' : 'Show more matches'} variant="ghost" loading={loadingMore} onPress={() => {
      if (moreLocal) setWindow({ searchKey, size: visible + 8 });
      else onLoadMore?.();
    }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  results: { gap: 8 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 68, borderWidth: 1, borderRadius: 14 },
  icon: { width: 32, height: 32, backgroundColor: '#FFFFFF', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 3 }, name: { fontFamily: typography.family, fontWeight: '600', fontSize: 14, lineHeight: 20 },
  price: { fontFamily: typography.family, fontWeight: '700', fontSize: 13, lineHeight: 19 },
  caption: { fontFamily: typography.family, fontSize: 12, lineHeight: 18 }, empty: { paddingVertical: 12, fontFamily: typography.family, fontSize: 14 },
});
