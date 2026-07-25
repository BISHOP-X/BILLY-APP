import { Ionicons } from '@expo/vector-icons';
import {
  type DimensionValue,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { StatusChip } from '@/components/ui/status-chip';
import type { ServiceSummary } from '@/features/main/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type ServiceTileProps = {
  onPress: () => void;
  service: ServiceSummary;
  width?: DimensionValue;
};

export function ServiceTile({ onPress, service, width = '100%' }: ServiceTileProps) {
  const theme = useBillyTheme();

  return (
    <Pressable
      accessibilityHint={service.message}
      accessibilityLabel={`${service.label}, ${service.state.replace('_', ' ')}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.72 : 1,
          width,
        },
      ]}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: theme.colors.brandMist }]}>
          <Ionicons
            accessible={false}
            color={theme.colors.brand}
            name={service.icon}
            size={24}
          />
        </View>
        <Ionicons
          accessible={false}
          color={theme.colors.textSoft}
          name="chevron-forward"
          size={18}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{service.label}</Text>
        <Text numberOfLines={3} style={[styles.description, { color: theme.colors.textMuted }]}>
          {service.description}
        </Text>
      </View>
      <StatusChip status={service.state} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    gap: 5,
  },
  description: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 17,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  tile: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    minHeight: 205,
    padding: spacing.lg,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '800',
  },
  top: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
