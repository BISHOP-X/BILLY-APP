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
  ink: '#182620',
  muted: '#626F68',
  line: '#DDE4DE',
  paper: '#FFFFFF',
  canvas: '#F4F6F3',
  green: '#166849',
  nav: '#10291E',
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
        <ActivityIndicator color={secondary ? adminColors.green : '#fff'} />
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
    <View style={{ gap: 7, flexGrow: 1 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#7D8981"
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
        large && { fontSize: 22, fontWeight: '700', lineHeight: 30 },
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
        { backgroundColor: good ? '#E2F2E8' : bad ? '#F9EAE4' : '#EEF0ED' },
      ]}
    >
      <Text
        style={{
          color: good ? '#155D3F' : bad ? '#953D28' : '#59645B',
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
    borderRadius: 18,
    padding: 22,
    gap: 16,
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: adminColors.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  secondary: {
    backgroundColor: '#F2F5F0',
    borderWidth: 1,
    borderColor: adminColors.line,
  },
  buttonText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  label: { fontSize: 12, fontWeight: '600', color: adminColors.muted },
  input: {
    minHeight: 46,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5CC',
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
