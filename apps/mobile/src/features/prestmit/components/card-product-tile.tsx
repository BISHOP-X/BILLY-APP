import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { ScalePressable } from '@/components/ui/motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

import type { BuyCardProduct } from '../domain';

function faceValue(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('en-NG', {
    currency,
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(amountMinor / 100);
}

export function CardProductTile({
  onPress,
  product,
}: {
  onPress: () => void;
  product: BuyCardProduct;
}) {
  const theme = useBillyTheme();
  return (
    <ScalePressable
      accessibilityHint="Opens a secure current-price review"
      accessibilityLabel={`${product.title}, from ${faceValue(
        product.minimumFaceValueMinor,
        product.currencyCode,
      )}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        shadows.card,
      ]}>
      <View style={[styles.art, { backgroundColor: theme.colors.brandMist }]}>
        {product.imageUrl ? (
          <Image
            accessibilityLabel=""
            contentFit="contain"
            source={{ uri: product.imageUrl }}
            style={styles.image}
          />
        ) : (
          <Text style={[styles.monogram, { color: theme.colors.brand }]}>
            {product.brand.slice(0, 1).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={styles.copy}>
        <View style={styles.heading}>
          <Text numberOfLines={2} style={[styles.title, { color: theme.colors.text }]}>
            {product.title}
          </Text>
          <Ionicons color={theme.colors.brand} name="arrow-forward" size={18} />
        </View>
        <Text style={[styles.meta, { color: theme.colors.textMuted }]}>
          {product.regions[0] ?? 'Current provider region'} ·{' '}
          {product.isPreOrder ? 'Pre-order' : 'Digital delivery'}
        </Text>
        <View style={[styles.range, { backgroundColor: theme.colors.brandMist }]}>
          <Text style={[styles.rangeText, { color: theme.colors.brand }]}>
            {faceValue(product.minimumFaceValueMinor, product.currencyCode)} –{' '}
            {faceValue(product.maximumFaceValueMinor, product.currencyCode)}
          </Text>
        </View>
      </View>
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  art: {
    alignItems: 'center',
    borderRadius: radii.lg,
    height: 72,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 72,
  },
  card: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 106,
    padding: spacing.md,
  },
  copy: {
    flex: 1,
    gap: 7,
    minWidth: 0,
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  meta: {
    fontFamily: typography.family,
    fontSize: 11,
  },
  monogram: {
    fontFamily: typography.familyRounded,
    fontSize: 30,
    fontWeight: '900',
  },
  range: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  rangeText: {
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
  },
  title: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 19,
  },
});
