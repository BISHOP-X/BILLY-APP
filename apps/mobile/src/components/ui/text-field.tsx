import { Ionicons } from '@expo/vector-icons';
import { ReactNode, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type TextFieldProps = TextInputProps & {
  disabled?: boolean;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  error?: string;
  rightSlot?: ReactNode;
};

export function TextField({
  disabled = false,
  label,
  icon,
  error,
  rightSlot,
  secureTextEntry,
  ...inputProps
}: TextFieldProps) {
  const theme = useBillyTheme();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const isPassword = Boolean(secureTextEntry);

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
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
        {icon ? (
          <Ionicons
            color={focused ? theme.colors.brand : theme.colors.textSoft}
            name={icon}
            size={20}
          />
        ) : null}
        <TextInput
          {...inputProps}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          accessibilityState={{ disabled }}
          editable={inputProps.editable ?? !disabled}
          onBlur={(event) => {
            setFocused(false);
            inputProps.onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            inputProps.onFocus?.(event);
          }}
          placeholderTextColor={theme.colors.textSoft}
          secureTextEntry={isPassword && !visible}
          selectionColor={theme.colors.brand}
          style={[styles.input, { color: theme.colors.text }, inputProps.style]}
        />
        {isPassword ? (
          <Pressable
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            accessibilityState={{ disabled }}
            disabled={disabled}
            hitSlop={10}
            onPress={() => setVisible((value) => !value)}>
            <Ionicons
              color={theme.colors.textMuted}
              name={visible ? 'eye-off-outline' : 'eye-outline'}
              size={21}
            />
          </Pressable>
        ) : (
          rightSlot
        )}
      </View>
      {error ? (
        <View accessibilityLiveRegion="polite" style={styles.errorRow}>
          <Ionicons color={theme.colors.danger} name="alert-circle" size={14} />
          <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '700',
  },
  field: {
    minHeight: 56,
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1.3,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 16,
    paddingVertical: 0,
  },
  errorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  error: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 17,
  },
});
