import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ScalePressable } from '@/components/ui/motion';
import type { ServiceKey, ServiceSummary } from '@/features/main/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

const quickServiceKeys: ServiceKey[] = [
  'bills',
  'gift_cards',
  'crypto',
  'foreign_numbers',
  'social_boost',
];

type QuickActionsGridProps = {
  onMore: () => void;
  onService: (service: ServiceSummary) => void;
  services: ServiceSummary[];
};

export function QuickActionsGrid({
  onMore,
  onService,
  services,
}: QuickActionsGridProps) {
  const theme = useBillyTheme();
  const { fontScale } = useWindowDimensions();
  const [innerWidth, setInnerWidth] = useState(0);
  const columns = innerWidth < 252 || fontScale > 1.45 ? 2 : 3;
  const itemWidth =
    innerWidth > 0
      ? Math.floor((innerWidth - spacing.sm * (columns - 1)) / columns)
      : columns === 2
        ? '47%'
        : '30%';
  const quickServices = quickServiceKeys
    .map((key) => services.find((service) => service.key === key))
    .filter((service): service is ServiceSummary => Boolean(service));

  return (
    <View
      onLayout={(event) => {
        const measured = event.nativeEvent.layout.width;
        if (Math.abs(measured - innerWidth) > 1) setInnerWidth(measured);
      }}
      style={styles.grid}>
      {quickServices.map((service) => (
        <ScalePressable
          accessibilityHint={
            service.canTransact
              ? 'Opens this service'
              : `Opens service information. ${service.message}`
          }
          accessibilityLabel={`${service.label}, ${service.state.replace('_', ' ')}`}
          accessibilityRole="button"
          key={service.key}
          onPress={() => onService(service)}
          style={[
            styles.tile,
            {
              backgroundColor: theme.colors.brandMist,
              borderColor: theme.colors.border,
              width: itemWidth,
            },
          ]}
          testID={`quick-${service.key}`}>
          <View style={[styles.iconCircle, { backgroundColor: theme.colors.surface }]}>
            <Ionicons
              accessible={false}
              color={theme.colors.brand}
              name={service.icon}
              size={25}
            />
          </View>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            numberOfLines={2}
            style={[styles.label, { color: theme.colors.text }]}>
            {service.label}
          </Text>
          {service.state === 'maintenance' ? (
            <View style={[styles.dot, { backgroundColor: theme.colors.warning }]} />
          ) : null}
        </ScalePressable>
      ))}
      <ScalePressable
        accessibilityHint="Opens the full service catalog"
        accessibilityLabel="More services"
        accessibilityRole="button"
        onPress={onMore}
        style={[
          styles.tile,
          {
            backgroundColor: theme.colors.brandMist,
            borderColor: theme.colors.border,
            width: itemWidth,
          },
        ]}
        testID="quick-more">
        <View style={[styles.iconCircle, { backgroundColor: theme.colors.surface }]}>
          <Ionicons accessible={false} color={theme.colors.brand} name="grid" size={25} />
        </View>
        <Text style={[styles.label, { color: theme.colors.text }]}>More</Text>
      </ScalePressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: radii.pill,
    height: 7,
    position: 'absolute',
    right: 9,
    top: 9,
    width: 7,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  label: {
    flexShrink: 1,
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
    textAlign: 'center',
  },
  tile: {
    alignItems: 'center',
    aspectRatio: 1.05,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 104,
    minWidth: 0,
    padding: spacing.sm,
  },
});
