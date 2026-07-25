import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing } from '@/theme/tokens';

export function SkeletonBlock({ style }: { style?: ViewStyle }) {
  const theme = useBillyTheme();
  const reducedMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0.42));

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.55);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.78,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.42,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion]);

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, { backgroundColor: theme.colors.border, opacity }, style]}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <View
      accessibilityLabel="Loading dashboard"
      accessibilityLiveRegion="polite"
      accessible
      style={styles.dashboard}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <SkeletonBlock style={styles.shortLine} />
          <SkeletonBlock style={styles.longLine} />
        </View>
        <SkeletonBlock style={styles.circle} />
      </View>
      <SkeletonBlock style={styles.wallet} />
      <SkeletonBlock style={styles.sectionLine} />
      <View style={styles.tiles}>
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonBlock key={index} style={styles.tile} />
        ))}
      </View>
      <SkeletonBlock style={styles.banner} />
      <SkeletonBlock style={styles.sectionLine} />
      <SkeletonBlock style={styles.row} />
      <SkeletonBlock style={styles.row} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    height: 116,
  },
  block: {
    borderRadius: radii.md,
    height: 20,
    width: '100%',
  },
  circle: {
    borderRadius: radii.pill,
    height: 46,
    width: 46,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  dashboard: {
    gap: spacing.xl,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  longLine: {
    height: 26,
    maxWidth: 220,
  },
  row: {
    height: 72,
  },
  sectionLine: {
    height: 23,
    maxWidth: 160,
  },
  shortLine: {
    height: 12,
    maxWidth: 100,
  },
  tile: {
    aspectRatio: 1.05,
    flexBasis: '30%',
    flexGrow: 1,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  wallet: {
    borderRadius: radii.xl,
    height: 224,
  },
});
