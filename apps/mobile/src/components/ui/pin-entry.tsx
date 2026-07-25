import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export type PinEntryHandle = {
  focus: () => void;
};

type PinEntryProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  testID?: string;
};

export const PinEntry = forwardRef<PinEntryHandle, PinEntryProps>(function PinEntry(
  { value, onChange, length = 6, autoFocus = false, testID },
  forwardedRef,
) {
  const theme = useBillyTheme();
  const inputRef = useRef<TextInput>(null);

  useImperativeHandle(forwardedRef, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  return (
    <Pressable
      accessibilityHint="Enter a six digit transaction PIN"
      accessibilityLabel={`Transaction PIN, ${value.length} of ${length} digits entered`}
      onPress={() => inputRef.current?.focus()}
      style={styles.wrapper}
      testID={testID}>
      <TextInput
        autoComplete="off"
        autoFocus={autoFocus}
        caretHidden
        contextMenuHidden
        importantForAutofill="noExcludeDescendants"
        keyboardType="number-pad"
        maxLength={length}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
        ref={inputRef}
        secureTextEntry
        style={styles.hiddenInput}
        textContentType="none"
        value={value}
      />
      <View style={styles.boxRow}>
        {Array.from({ length }).map((_, index) => {
          const filled = index < value.length;
          const active = index === value.length;
          return (
            <View
              key={index}
              style={[
                styles.box,
                {
                  backgroundColor: filled ? theme.colors.brandMist : theme.colors.surface,
                  borderColor: active ? theme.colors.brand : theme.colors.border,
                },
              ]}>
              <Text
                style={[
                  styles.dot,
                  { color: filled ? theme.colors.brand : 'transparent' },
                ]}>
                ●
              </Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  hiddenInput: {
    height: 1,
    opacity: 0,
    position: 'absolute',
    width: 1,
  },
  boxRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  box: {
    alignItems: 'center',
    aspectRatio: 0.86,
    borderRadius: radii.md,
    borderWidth: 1.4,
    flex: 1,
    justifyContent: 'center',
    maxWidth: 58,
    minHeight: 58,
  },
  dot: {
    fontFamily: typography.familyRounded,
    fontSize: 19,
  },
});
