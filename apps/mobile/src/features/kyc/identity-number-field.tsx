import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { KycMethod } from '@/features/services/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type IdentityNumberFieldProps = {
  disabled?: boolean;
  error?: string | null;
  method: KycMethod;
  onChangeText: (value: string) => void;
  value: string;
  visibilityResetToken: number;
};

function identityLabel(method: KycMethod) {
  return method === 'bvn_basic' ? 'BVN' : 'NIN';
}

export function IdentityNumberField({
  disabled = false,
  error,
  method,
  onChangeText,
  value,
  visibilityResetToken,
}: IdentityNumberFieldProps) {
  const theme = useBillyTheme();
  const [focused, setFocused] = useState(false);
  const [revealedAtToken, setRevealedAtToken] = useState<number | null>(null);
  const label = `${identityLabel(method)} number`;
  const revealed =
    value.length > 0 && revealedAtToken === visibilityResetToken;

  return (
    <View style={styles.wrapper}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
        <Text style={[styles.requirement, { color: theme.colors.textSoft }]}>
          11 digits
        </Text>
      </View>
      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error
              ? theme.colors.danger
              : focused
                ? theme.colors.brand
                : theme.colors.border,
          },
        ]}>
        <Ionicons
          accessible={false}
          color={focused ? theme.colors.brand : theme.colors.textSoft}
          name="keypad-outline"
          size={20}
        />
        <TextInput
          accessibilityHint="The number is hidden by default and cleared as soon as you submit it."
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          autoComplete="off"
          autoCorrect={false}
          editable={!disabled}
          importantForAutofill="no"
          keyboardType="number-pad"
          maxLength={11}
          onBlur={() => setFocused(false)}
          onChangeText={(nextValue) => {
            const sanitizedValue = nextValue.replace(/\D/g, '').slice(0, 11);
            if (!sanitizedValue) {
              setRevealedAtToken(null);
            }
            onChangeText(sanitizedValue);
          }}
          onFocus={() => setFocused(true)}
          placeholder="Enter 11 digits"
          placeholderTextColor={theme.colors.textSoft}
          secureTextEntry={!revealed}
          selectionColor={theme.colors.brand}
          style={[styles.input, { color: theme.colors.text }]}
          textContentType="none"
          value={value}
        />
        <Pressable
          accessibilityLabel={
            revealed ? `Hide ${identityLabel(method)}` : `Show ${identityLabel(method)}`
          }
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={10}
          onPress={() =>
            setRevealedAtToken(revealed ? null : visibilityResetToken)
          }>
          <Ionicons
            accessible={false}
            color={theme.colors.textMuted}
            name={revealed ? 'eye-off-outline' : 'eye-outline'}
            size={21}
          />
        </Pressable>
      </View>
      {error ? (
        <View accessibilityLiveRegion="polite" style={styles.errorRow}>
          <Ionicons
            accessible={false}
            color={theme.colors.danger}
            name="alert-circle"
            size={14}
          />
          <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text>
        </View>
      ) : (
        <Text style={[styles.helper, { color: theme.colors.textSoft }]}>
          Billy never displays the complete number in your history.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 17,
  },
  errorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  field: {
    minHeight: 58,
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1.3,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  helper: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
  input: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 2,
    paddingVertical: 0,
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  requirement: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '700',
  },
  wrapper: {
    gap: spacing.xs,
  },
});
