import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillyLogo } from '@/components/ui/billy-logo';
import { AdminButton, adminColors as c } from './components';
import { adminSections, type AdminSection } from './domain';

export const adminNavigationGroups: {
  label: string;
  sections: AdminSection[];
}[] = [
  { label: 'Workspace', sections: ['overview', 'transactions', 'funding'] },
  { label: 'Customers', sections: ['users', 'kyc', 'support'] },
  { label: 'Services', sections: ['numbers', 'social', 'catalog'] },
  { label: 'Manage', sections: ['settings', 'audit'] },
];

type Props = {
  wide: boolean;
  section: AdminSection;
  onNavigate: (section: AdminSection) => void;
  onUserSection: () => void;
  onSignOut: () => void;
};

export function AdminNavigation({
  wide,
  section,
  onNavigate,
  onUserSection,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false);
  const closeAnd = (action: () => void) => {
    setOpen(false);
    action();
  };
  const contents = (
    <>
      <View style={s.brand}>
        <BillyLogo variant="wordmark" size={90} />
        <Text style={s.adminLabel}>ADMIN</Text>
        {!wide ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close admin menu"
            onPress={() => setOpen(false)}
            style={s.iconButton}
          >
            <Ionicons name="close" size={22} color={c.ink} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={s.groups}
        showsVerticalScrollIndicator={false}
      >
        {adminNavigationGroups.map((group) => (
          <View key={group.label} style={s.group}>
            <Text style={s.groupLabel}>{group.label}</Text>
            {group.sections.map((id) => {
              const [, label, icon] = adminSections.find(
                (item) => item[0] === id,
              )!;
              const selected = section === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => closeAnd(() => onNavigate(id))}
                  style={({ pressed }) => [
                    s.item,
                    selected && s.selected,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Ionicons
                    name={icon}
                    size={18}
                    color={selected ? c.green : c.muted}
                  />
                  <Text style={[s.itemLabel, selected && { color: c.ink }]}>
                    {label}
                  </Text>
                  {selected ? <View style={s.activeDot} /> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={s.footer}>
        <AdminButton
          label="User Section"
          secondary
          onPress={() => closeAnd(onUserSection)}
        />
        <View style={s.identity}>
          <View style={s.avatar}>
            <Ionicons
              name="shield-checkmark-outline"
              color={c.green}
              size={18}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemLabel}>Billy admin</Text>
            <Text style={s.email}>support@billyapp.org</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={() => closeAnd(onSignOut)}
            style={s.iconButton}
          >
            <Ionicons name="log-out-outline" color={c.muted} size={20} />
          </Pressable>
        </View>
      </View>
    </>
  );
  if (wide) return <View style={s.sidebar}>{contents}</View>;
  return (
    <>
      <View style={s.mobileBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open admin menu"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          style={s.iconButton}
        >
          <Ionicons name="menu-outline" size={24} color={c.ink} />
        </Pressable>
        <BillyLogo variant="wordmark" size={76} />
        <AdminButton label="User Section" secondary onPress={onUserSection} />
      </View>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={s.overlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close admin menu backdrop"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={s.drawer} accessibilityViewIsModal>
            {contents}
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  sidebar: {
    width: 252,
    backgroundColor: c.nav,
    borderRightWidth: 1,
    borderRightColor: c.line,
  },
  brand: {
    minHeight: 90,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  adminLabel: { color: c.muted, fontSize: 9, letterSpacing: 1.8, flex: 1 },
  groups: { paddingHorizontal: 14, paddingBottom: 24, gap: 24 },
  group: { gap: 4 },
  groupLabel: {
    fontSize: 10,
    color: c.muted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  item: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  itemLabel: { fontSize: 13, color: c.muted, fontWeight: '500' },
  selected: { backgroundColor: c.raised },
  activeDot: {
    marginLeft: 'auto',
    height: 5,
    width: 5,
    borderRadius: 3,
    backgroundColor: c.green,
  },
  footer: { borderTopWidth: 1, borderTopColor: c.line, padding: 16, gap: 18 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: c.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  email: { color: c.muted, fontSize: 10, marginTop: 4 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  mobileBar: {
    minHeight: 72,
    paddingHorizontal: 12,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.nav,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  drawer: {
    width: 300,
    maxWidth: '90%',
    height: '100%',
    backgroundColor: c.nav,
    borderRightWidth: 1,
    borderRightColor: c.line,
  },
});
