import Ionicons from '@expo/vector-icons/Ionicons';
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
  appearance?: 'default' | 'auth';
  disabled?: boolean;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  error?: string;
  rightSlot?: ReactNode;
};

export function TextField({
  appearance = 'default',
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
  const isAuth = appearance === 'auth';
  const colors = isAuth
    ? {
        field: '#FFFFFF',
        label: '#1A241E',
        muted: '#748078',
        text: '#18211B',
        border: '#DCE5DF',
        focus: '#146237',
      }
    : {
        field: theme.colors.surface,
        label: theme.colors.text,
        muted: theme.colors.textSoft,
        text: theme.colors.text,
        border: theme.colors.border,
        focus: theme.colors.brand,
      };

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: colors.label }]}>{label}</Text>
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.field,
            borderColor: error
              ? theme.colors.danger
              : focused
                ? colors.focus
                : colors.border,
          },
        ]}>
        {icon ? (
          <Ionicons
            color={focused ? colors.focus : colors.muted}
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
          placeholderTextColor={colors.muted}
          secureTextEntry={isPassword && !visible}
          selectionColor={colors.focus}
          style={[styles.input, { color: colors.text }, inputProps.style]}
        />
        {isPassword ? (
          <Pressable
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            accessibilityState={{ disabled }}
            disabled={disabled}
            hitSlop={10}
            onPress={() => setVisible((value) => !value)}>
            <Ionicons
              color={colors.muted}
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
