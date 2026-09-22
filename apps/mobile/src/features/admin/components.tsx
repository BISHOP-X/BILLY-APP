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
export const adminColors = {
  ink: '#F0F5F1',
  muted: '#A4B5AA',
  line: '#293B31',
  paper: '#13221A',
  canvas: '#0C1711',
  green: '#96E0B4',
  nav: '#0F1D16',
  raised: '#1B3024',
  onGreen: '#092617',
  gold: '#E8C78A',
};
export function Panel({ children }: { children: ReactNode }) {
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
  return (
    <View style={{ gap: 7, flexGrow: 1, minWidth: 180, maxWidth: '100%' }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#82958A"
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
        { backgroundColor: good ? '#203E2D' : bad ? '#402E27' : '#26352C' },
      ]}
    >
      <Text
        style={{
          color: good ? '#A4E9BD' : bad ? '#F0B9A5' : '#C0CDC4',
          fontSize: 11,
          fontWeight: '700',
        }}
      >
        {text.replaceAll('_', ' ')}
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
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
