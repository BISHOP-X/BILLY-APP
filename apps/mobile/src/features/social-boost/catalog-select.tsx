import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { typography } from '@/theme/tokens';

export type CatalogOption = { value: string; label: string; detail?: string };

export function CatalogSelect({ label, placeholder, value, selectedLabel, options, onSelect, disabled = false, loading = false, onLoadMore, loadingMore = false, loadError, searchable = true }: {
  label: string; placeholder: string; value: string; options: CatalogOption[];
  selectedLabel?: string;
  onSelect: (value: string) => void; disabled?: boolean; loading?: boolean;
  onLoadMore?: () => void; loadingMore?: boolean; loadError?: string; searchable?: boolean;
}) {
  const theme = useBillyTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.value === value);
  const displayLabel = selected?.label ?? (value ? selectedLabel : undefined);
  const filtered = options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()));
  return <View style={styles.field}>
    <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${displayLabel ?? placeholder}`} accessibilityState={{ disabled: disabled || loading, expanded: open, busy: loading }} disabled={disabled || loading} onPress={() => { setSearch(''); setOpen(true); }} style={[styles.trigger, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border, opacity: disabled ? 0.55 : 1 }]}>
      <Text numberOfLines={2} style={[styles.value, { color: displayLabel ? theme.colors.text : theme.colors.textMuted }]}>{displayLabel ?? placeholder}</Text>
      {loading ? <ActivityIndicator color={theme.colors.brand} /> : <Ionicons name="chevron-down" size={18} color={theme.colors.textMuted} />}
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        <SafeAreaView accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.text }]}>{label}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Close ${label.toLowerCase()} picker`} onPress={() => setOpen(false)} style={styles.close}><Ionicons name="close" size={24} color={theme.colors.text} /></Pressable>
          </View>
          {searchable ? <TextField label={`Search ${label.toLowerCase()}`} icon="search-outline" autoCapitalize="none" value={search} onChangeText={setSearch} /> : null}
          <FlatList data={filtered} keyExtractor={(option) => option.value} keyboardShouldPersistTaps="handled" style={styles.list} renderItem={({ item }) => (
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: item.value === value }} onPress={() => { onSelect(item.value); setOpen(false); }} style={[styles.option, { borderColor: theme.colors.border, backgroundColor: item.value === value ? theme.colors.brandMist : theme.colors.surface }]}>
              <View style={styles.optionCopy}><Text style={[styles.value, { color: theme.colors.text }]}>{item.label}</Text>{item.detail ? <Text style={[styles.detail, { color: theme.colors.textMuted }]}>{item.detail}</Text> : null}</View>
              {item.value === value ? <Ionicons name="checkmark" color={theme.colors.brand} size={20} /> : null}
            </Pressable>
          )} ListEmptyComponent={<Text style={[styles.empty, { color: theme.colors.textMuted }]}>No matches. Try another search.</Text>} ListFooterComponent={<View style={styles.footer}>
            {loadError ? <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{loadError}</Text> : null}
            {onLoadMore ? <AppButton label={loadError ? 'Retry loading services' : 'Load more services'} variant="secondary" onPress={onLoadMore} loading={loadingMore} /> : null}
          </View>} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  field: { gap: 8 }, label: { fontFamily: typography.family, fontSize: 14, fontWeight: '700' },
  trigger: { minHeight: 58, padding: 16, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { fontFamily: typography.family, fontSize: 14, lineHeight: 21, flexShrink: 1, flexGrow: 1 },
  overlay: { flex: 1, justifyContent: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 640, height: '82%', maxHeight: 720, alignSelf: 'center', borderRadius: 24, padding: 20, gap: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: typography.familyRounded, fontSize: 21, fontWeight: '800' },
  close: { padding: 10, minWidth: 44, minHeight: 44 }, list: { flex: 1 },
  option: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 14, minHeight: 56, borderBottomWidth: 1, borderRadius: 10 },
  optionCopy: { flex: 1, gap: 4 }, detail: { fontFamily: typography.family, fontSize: 12 },
  empty: { paddingVertical: 24 }, footer: { gap: 12, paddingVertical: 12 },
});
