import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import type { BillyTheme } from '@/theme/tokens';

export function useAdminColors() {
  return getAdminColors(useBillyTheme());
}
export function getAdminColors(theme: BillyTheme) {
  return {
    ink: theme.colors.text, muted: theme.colors.textMuted,
    line: theme.colors.border, paper: theme.colors.surface,
    canvas: theme.colors.canvas, green: theme.colors.brand,
    nav: theme.colors.surface, raised: theme.colors.surfaceRaised,
    onGreen: theme.colors.onBrand,
    gold: theme.colors.warning,
  };
}
export type AdminPalette = ReturnType<typeof useAdminColors>;
export function Panel({ children }: { children: ReactNode }) {
  const adminColors = useAdminColors();
  const s = createStyles(adminColors);
  return <View style={s.panel}>{children}</View>;
}
export function AdminButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: boolean;
}) {
  const adminColors = useAdminColors();
  const s = createStyles(adminColors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={secondary ? adminColors.green : adminColors.onGreen}
        />
      ) : null}
      <Text style={[s.buttonText, secondary && { color: adminColors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function AdminInput({
  label,
  ...props
}: TextInputProps & { label: string }) {
  const adminColors = useAdminColors();
  const s = createStyles(adminColors);
  return (
    <View style={{ gap: 7, flexGrow: 1, minWidth: 180, maxWidth: '100%' }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={adminColors.muted}
        selectionColor={adminColors.green}
        {...props}
        style={[s.input, props.style]}
      />
    </View>
  );
}
export function AdminText({
  children,
  muted = false,
  large = false,
}: {
  children: ReactNode;
  muted?: boolean;
  large?: boolean;
}) {
  const adminColors = useAdminColors();
  const s = createStyles(adminColors);
  return (
    <Text
      style={[
        s.text,
        muted && { color: adminColors.muted },
        large && { fontSize: 18, fontWeight: '600', lineHeight: 26 },
      ]}
    >
      {children}
    </Text>
  );
}
export function Badge({ value }: { value: unknown }) {
  const adminColors = useAdminColors();
  const s = createStyles(adminColors);
  const text = String(value ?? 'unknown');
  const good = [
    'available',
    'active',
    'all',
    'succeeded',
    'received',
    'verified',
    'resolved',
  ].includes(text);
  const bad = ['failed', 'frozen', 'manual_review', 'off'].includes(text);
  return (
    <View
      style={[
        s.badge,
        { backgroundColor: good ? `${adminColors.green}18` : bad ? `${adminColors.gold}18` : adminColors.raised },
      ]}
    >
      <Text
        style={{
          color: good ? adminColors.green : bad ? adminColors.gold : adminColors.muted,
          fontSize: 11,
          fontWeight: '700',
        }}
      >
        {text.replaceAll('_', ' ')}
      </Text>
    </View>
  );
}
const createStyles = (adminColors: AdminPalette) => StyleSheet.create({
  panel: {
    backgroundColor: adminColors.paper,
    borderWidth: 1,
    borderColor: adminColors.line,
    borderRadius: 20,
    padding: 20,
    gap: 16,
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: adminColors.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  secondary: {
    backgroundColor: adminColors.raised,
    borderWidth: 1,
    borderColor: adminColors.line,
  },
  buttonText: { color: adminColors.onGreen, fontWeight: '600', fontSize: 13 },
  label: { fontSize: 12, fontWeight: '600', color: adminColors.muted },
  input: {
    minHeight: 46,
    backgroundColor: adminColors.canvas,
    borderWidth: 1,
    borderColor: adminColors.line,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 15,
    color: adminColors.ink,
  },
  text: { fontSize: 14, lineHeight: 22, color: adminColors.ink },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
  },
});
