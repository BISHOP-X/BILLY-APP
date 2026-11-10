import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, typography } from './tokens';
import { type AppearancePreference, useAppearance } from './appearance-provider';

const choices = [
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
] as const;

export function AppearancePicker() {
  const theme = useBillyTheme();
  const { preference, setPreference } = useAppearance();
  return (
    <View accessibilityLabel="Appearance" accessibilityRole="radiogroup" style={[styles.track, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
      {choices.map(choice => {
        const selected = preference === choice.value;
        const foreground = selected ? theme.colors.text : theme.colors.textMuted;
        return <Pressable key={choice.value} accessibilityLabel={`${choice.label} appearance`} accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected}
          onPress={() => setPreference(choice.value as AppearancePreference)}
          style={[styles.choice, selected && { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Ionicons name={choice.icon} size={17} color={selected ? theme.colors.brand : foreground} />
          <Text style={[styles.label, { color: foreground }]}>{choice.label}</Text>
        </Pressable>;
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 4, borderRadius: radii.lg, borderWidth: 1, gap: 4 },
  choice: { flex: 1, minHeight: 44, borderRadius: radii.md, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  label: { fontFamily: typography.family, fontSize: 12, fontWeight: '600' },
});
