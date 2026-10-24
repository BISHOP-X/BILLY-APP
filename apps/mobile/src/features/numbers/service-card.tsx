import { Image } from 'expo-image';
import { brandTileBackground, serviceBrand, serviceInitials } from './brand-registry';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { ScalePressable } from '@/components/ui/motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { formatMinorUnits } from '@/features/wallet/money';

export { serviceBrand } from './brand-registry';

export function ServiceAvatar(
  { name, size = 44 }: { name: string; size?: number },
) {
  const brand = serviceBrand(name);
  const fallback = serviceInitials(name);
  return (
    <View
      accessible={false}
      style={[styles.avatar, {
        width: size,
        height: size,
        backgroundColor: brand ? brandTileBackground(brand.color) : fallback.color,
      }]}
    >
      {brand?.uri
        ? (
          <Image
            source={{ uri: brand.uri }}
            style={{ width: size * 0.58, height: size * 0.58 }}
            contentFit="contain"
            transition={0}
            accessible={false}
          />
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
          <Text style={[styles.initials, { color: '#FFFFFF' }]}>
            {fallback.initials}
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
