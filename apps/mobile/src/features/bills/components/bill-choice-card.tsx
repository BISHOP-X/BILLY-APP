import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { ScalePressable } from '@/components/ui/motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type BillChoiceCardProps = {
  description?: string;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  selected: boolean;
  testID?: string;
  trailing?: string;
};

export function BillChoiceCard({
  description,
  disabled = false,
  label,
  onPress,
  selected,
  testID,
  trailing,
}: BillChoiceCardProps) {
  const theme = useBillyTheme();

  return (
    <ScalePressable
      accessibilityLabel={`${label}${trailing ? `, ${trailing}` : ''}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: selected
            ? theme.colors.brandMist
            : theme.colors.surface,
          borderColor: selected ? theme.colors.brand : theme.colors.border,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
      testID={testID}>
      <View
        style={[
          styles.radio,
          {
            backgroundColor: selected ? theme.colors.brand : 'transparent',
            borderColor: selected ? theme.colors.brand : theme.colors.border,
          },
        ]}>
        {selected ? (
          <Ionicons color={theme.colors.white} name="checkmark" size={14} />
        ) : null}
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
        {description ? (
          <Text style={[styles.description, { color: theme.colors.textMuted }]}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text style={[styles.trailing, { color: theme.colors.brand }]}>
          {trailing}
        </Text>
      ) : null}
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1.3,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 72,
    padding: spacing.md,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  description: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  radio: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1.4,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  trailing: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
});
