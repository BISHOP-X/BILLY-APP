import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { KycSummary, ServiceSummary } from '@/features/main/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';

type ServiceBannerProps = {
  kyc: KycSummary;
  onPress: () => void;
  services: ServiceSummary[];
};

export function ServiceBanner({ kyc, onPress, services }: ServiceBannerProps) {
  const theme = useBillyTheme();
  const maintenance = services.some(
    (service) => service.state === 'maintenance',
  );
  if (!maintenance && kyc.accessCode === 'verified') return null;
  const pending = kyc.status === 'pending' || kyc.status === 'in_progress';
  const title = maintenance
    ? 'Some services are unavailable'
    : pending
      ? 'Verification in progress'
      : 'Verify your identity';
  const body = maintenance
    ? 'Check which services are available.'
    : pending
      ? 'Check the latest update.'
      : 'Required for crypto and selling gift cards.';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={body}
      onPress={onPress}
      style={({ pressed }) => [
        styles.notice,
        { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons
        name={
          maintenance
            ? 'information-circle-outline'
            : 'shield-checkmark-outline'
        }
        size={22}
        color={theme.colors.textMuted}
      />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          {title}
        </Text>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>
          {body}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={17}
        color={theme.colors.textMuted}
      />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: 1,
    paddingVertical: 22,
    marginTop: 8,
    minHeight: 72,
  },
  copy: { flex: 1, gap: 5 },
  title: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 12, lineHeight: 18 },
});
