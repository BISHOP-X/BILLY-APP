import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

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

const THREE_COLUMN_MIN_TILE_WIDTH = 88;

export function getQuickActionColumnCount(viewportWidth: number, fontScale: number) {
  const constrainedWidth = Math.min(viewportWidth, 720);
  const estimatedGridWidth = Math.max(0, constrainedWidth - spacing.lg * 4 - 2);
  const threeColumnTileWidth = (estimatedGridWidth - spacing.sm * 2) / 3;
  const scaledMinimum = THREE_COLUMN_MIN_TILE_WIDTH * Math.min(Math.max(fontScale, 1), 1.2);

  return threeColumnTileWidth >= scaledMinimum ? 3 : 2;
}

export function QuickActionsGrid({
  onMore,
  onService,
  services,
}: QuickActionsGridProps) {
  const theme = useBillyTheme();
  const { fontScale, width } = useWindowDimensions();
  const columns = getQuickActionColumnCount(width, fontScale);
  const quickServices = quickServiceKeys
    .map((key) => services.find((service) => service.key === key))
    .filter((service): service is ServiceSummary => Boolean(service));
  const actions = [
    ...quickServices.map((service) => ({ kind: 'service' as const, service })),
    { kind: 'more' as const },
  ];
  const rows = Array.from({ length: Math.ceil(actions.length / columns) }, (_, index) =>
    actions.slice(index * columns, (index + 1) * columns),
  );

  return (
    <View style={styles.grid}>
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.row} testID={`quick-actions-row-${rowIndex}`}>
          {row.map((action) => {
            if (action.kind === 'more') {
              return (
                <ScalePressable
                  accessibilityHint="Opens the full service catalog"
                  accessibilityLabel="More services"
                  accessibilityRole="button"
                  containerStyle={styles.slot}
                  key="more"
                  onPress={onMore}
                  style={[
                    styles.tile,
                    styles.tileShadow,
                    {
                      backgroundColor: theme.dark
                        ? theme.colors.surfaceMuted
                        : theme.colors.brandMist,
                      borderColor: theme.dark
                        ? 'rgba(133, 227, 173, 0.16)'
                        : theme.colors.border,
                    },
                  ]}
                  testID="quick-more">
                  <View style={[styles.iconCircle, { backgroundColor: theme.colors.surface }]}>
                    <Ionicons accessible={false} color={theme.colors.brand} name="grid" size={25} />
                  </View>
                  <Text style={[styles.label, { color: theme.colors.text }]}>More</Text>
                </ScalePressable>
              );
            }

            const service = action.service;
            return (
              <ScalePressable
                accessibilityHint={
                  service.canTransact
                    ? 'Opens this service'
                    : `Opens service information. ${service.message}`
                }
                accessibilityLabel={`${service.label}, ${service.state.replace('_', ' ')}`}
                accessibilityRole="button"
                containerStyle={styles.slot}
                key={service.key}
                onPress={() => onService(service)}
                style={[
                  styles.tile,
                  styles.tileShadow,
                  {
                    backgroundColor: theme.dark
                      ? theme.colors.surfaceMuted
                      : theme.colors.brandMist,
                    borderColor: theme.dark
                      ? 'rgba(133, 227, 173, 0.16)'
                      : theme.colors.border,
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
            );
          })}
          {Array.from({ length: columns - row.length }, (_, spacerIndex) => (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              key={`spacer-${spacerIndex}`}
              style={styles.slot}
            />
          ))}
        </View>
      ))}
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
    gap: spacing.md,
    paddingHorizontal: spacing.xxs,
  },
  row: {
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  slot: {
    flex: 1,
    minWidth: 0,
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
    aspectRatio: 1.15,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 96,
    minWidth: 0,
    padding: spacing.sm,
    width: '100%',
  },
  tileShadow: Platform.select({
    web: {
      boxShadow: '0 8px 20px rgba(0, 0, 0, 0.12)',
    },
    default: {
      elevation: 2,
      shadowColor: '#000000',
      shadowOffset: { height: 4, width: 0 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
    },
  }),
});
