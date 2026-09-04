import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { ScalePressable } from '@/components/ui/motion';
import type { KycMethod } from '@/features/services/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type KycMethodPickerProps = {
  disabled?: boolean;
  onChange: (method: KycMethod) => void;
  value: KycMethod;
};

const methods: {
  description: string;
  label: string;
  value: KycMethod;
}[] = [
  {
    description: 'Bank Verification Number',
    label: 'BVN',
    value: 'bvn_basic',
  },
  {
    description: 'National Identification Number',
    label: 'NIN',
    value: 'vnin_basic',
  },
];

export function KycMethodPicker({
  disabled = false,
  onChange,
  value,
}: KycMethodPickerProps) {
  const theme = useBillyTheme();

  return (
    <View accessibilityRole="radiogroup" style={styles.container}>
      {methods.map((method) => {
        const selected = value === method.value;
        return (
          <View key={method.value} style={styles.optionSlot}>
            <ScalePressable
              accessibilityLabel={`${method.label}, ${method.description}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(method.value)}
              style={[
                styles.option,
                {
                  backgroundColor: selected
                    ? theme.colors.brandMist
                    : theme.colors.surface,
                  borderColor: selected
                    ? theme.colors.brand
                    : theme.colors.border,
                },
              ]}>
              <View style={styles.optionTop}>
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor: selected
                        ? theme.colors.brand
                        : theme.colors.surfaceMuted,
                    },
                  ]}>
                  <Ionicons
                    accessible={false}
                    color={
                      selected ? theme.colors.white : theme.colors.textMuted
                    }
                    name={
                      method.value === 'bvn_basic'
                        ? 'business-outline'
                        : 'person-outline'
                    }
                    size={19}
                  />
                </View>
                <Ionicons
                  accessible={false}
                  color={selected ? theme.colors.brand : theme.colors.border}
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={21}
                />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.label, { color: theme.colors.text }]}>
                  {method.label}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.description,
                    { color: theme.colors.textMuted },
                  ]}>
                  {method.description}
                </Text>
              </View>
            </ScalePressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  copy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  description: {
    fontFamily: typography.family,
    fontSize: 10,
    lineHeight: 14,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  option: {
    minHeight: 112,
    alignItems: 'stretch',
    borderRadius: radii.lg,
    borderWidth: 1.2,
    flexDirection: 'column',
    gap: spacing.xs,
    minWidth: 0,
    padding: spacing.sm,
    width: '100%',
  },
  optionSlot: {
    flex: 1,
    minWidth: 0,
  },
  optionTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
