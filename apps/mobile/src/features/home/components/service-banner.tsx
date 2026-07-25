import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { KycSummary, ServiceSummary } from '@/features/main/domain';
import { radii, spacing, typography } from '@/theme/tokens';

type ServiceBannerProps = {
  kyc: KycSummary;
  onPress: () => void;
  services: ServiceSummary[];
};

export function ServiceBanner({ kyc, onPress, services }: ServiceBannerProps) {
  const maintenanceCount = services.filter(
    (service) => service.state === 'maintenance',
  ).length;
  const needsKyc = kyc.accessCode !== 'verified';
  const title = maintenanceCount
    ? `${maintenanceCount} service${maintenanceCount === 1 ? '' : 's'} paused`
    : needsKyc
      ? 'Verify only when you need to'
      : 'Your Billy security matters';
  const body = maintenanceCount
    ? 'See current availability before starting a service.'
    : needsKyc
      ? kyc.accessReason
      : 'Review privacy and security settings whenever your device or needs change.';

  return (
    <Pressable
      accessibilityHint="Opens more information"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <LinearGradient
        colors={['#0B4829', '#146237']}
        end={{ x: 1, y: 0 }}
        start={{ x: 0, y: 0 }}
        style={styles.banner}>
        <View style={styles.icon}>
          <Ionicons
            accessible={false}
            color="#146237"
            name={maintenanceCount ? 'construct-outline' : 'shield-checkmark-outline'}
            size={25}
          />
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>GOOD TO KNOW</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
        </View>
        <Ionicons accessible={false} color="#FFFFFF" name="chevron-forward" size={20} />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    borderRadius: radii.xl,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 120,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  body: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 17,
  },
  copy: {
    flex: 1,
    gap: 3,
  },
  eyebrow: {
    color: '#B8F3CF',
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  pressed: {
    opacity: 0.8,
  },
  title: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '800',
  },
});
