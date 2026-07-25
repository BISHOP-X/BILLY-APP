import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { useAuth } from '@/features/auth/auth-provider';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

const previewServices = [
  { emoji: '💡', label: 'Pay bills' },
  { emoji: '🎁', label: 'Gift cards' },
  { emoji: '₿', label: 'Crypto' },
  { emoji: '🌍', label: 'Foreign numbers' },
];

export default function LegacyHomeRoute() {
  return <Redirect href="/(app)/(tabs)/home" />;
}

export function PhaseCompleteHomePreview() {
  const theme = useBillyTheme();
  const { signOut, user } = useAuth();
  const firstName = String(user?.user_metadata?.first_name || 'there');

  async function handleSignOut() {
    await signOut();
    router.replace('/(auth)/sign-in');
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FadeSlide>
          <View style={styles.header}>
            <View>
              <Text style={[styles.kicker, { color: theme.colors.textMuted }]}>GOOD TO SEE YOU</Text>
              <Text style={[styles.greeting, { color: theme.colors.text }]}>
                Hello, {firstName} <Text accessible={false}>👋</Text>
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Sign out"
              accessibilityRole="button"
              onPress={handleSignOut}
              style={[styles.avatar, { backgroundColor: theme.colors.brandMist }]}>
              <Ionicons color={theme.colors.brand} name="person" size={21} />
            </Pressable>
          </View>
        </FadeSlide>

        <FadeSlide delay={70}>
          <LinearGradient
            colors={['#0B4829', '#146237', '#258F62']}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={styles.readyCard}>
            <View style={styles.readyTop}>
              <View style={styles.readyIcon}>
                <Ionicons color="#146237" name="checkmark" size={26} />
              </View>
              <View style={styles.readyCopy}>
                <Text style={styles.readyKicker}>YOU’RE ALL SET</Text>
                <Text style={styles.readyTitle}>Welcome to your Billy</Text>
              </View>
            </View>
            <Text style={styles.readyBody}>
              Your secure account foundation is ready. Wallet and service modules arrive in the
              next phase.
            </Text>
          </LinearGradient>
        </FadeSlide>

        <FadeSlide delay={130}>
          <View
            style={[
              styles.walletCard,
              shadows.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}>
            <View style={styles.walletHeader}>
              <Text style={[styles.walletLabel, { color: theme.colors.textMuted }]}>
                Wallet preview
              </Text>
              <View style={[styles.previewPill, { backgroundColor: theme.colors.brandMist }]}>
                <Text style={[styles.previewPillText, { color: theme.colors.brand }]}>COMING NEXT</Text>
              </View>
            </View>
            <Text style={[styles.balance, { color: theme.colors.text }]}>₦ 0.00</Text>
            <View style={styles.walletActions}>
              <View style={[styles.walletAction, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons color={theme.colors.textSoft} name="add-circle-outline" size={19} />
                <Text style={[styles.walletActionText, { color: theme.colors.textMuted }]}>
                  Add money
                </Text>
              </View>
              <View style={[styles.walletAction, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons color={theme.colors.textSoft} name="arrow-up-circle-outline" size={19} />
                <Text style={[styles.walletActionText, { color: theme.colors.textMuted }]}>
                  Withdraw
                </Text>
              </View>
            </View>
          </View>
        </FadeSlide>

        <FadeSlide delay={190}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>What’s coming</Text>
            <Ionicons color={theme.colors.brand} name="sparkles" size={18} />
          </View>
          <View style={styles.serviceGrid}>
            {previewServices.map((service) => (
              <ScalePressable
                accessibilityLabel={`${service.label}, coming soon`}
                disabled
                key={service.label}
                style={[
                  styles.serviceCard,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}>
                <Text accessible={false} style={styles.serviceEmoji}>
                  {service.emoji}
                </Text>
                <Text style={[styles.serviceLabel, { color: theme.colors.text }]}>
                  {service.label}
                </Text>
              </ScalePressable>
            ))}
          </View>
        </FadeSlide>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    gap: spacing.xl,
    maxWidth: 600,
    paddingBottom: spacing.xxxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kicker: {
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  greeting: {
    fontFamily: typography.familyRounded,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginTop: 4,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  readyCard: {
    borderRadius: radii.xl,
    gap: spacing.md,
    padding: spacing.xl,
  },
  readyTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  readyIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  readyCopy: {
    flex: 1,
  },
  readyKicker: {
    color: '#B8F3CF',
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  readyTitle: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 3,
  },
  readyBody: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
  },
  walletCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  walletHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  walletLabel: {
    fontFamily: typography.family,
    fontSize: 13,
  },
  previewPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewPillText: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  balance: {
    fontFamily: typography.familyRounded,
    fontSize: 30,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  walletActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  walletAction: {
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: 13,
  },
  walletActionText: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '800',
  },
  serviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  serviceCard: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 112,
    padding: spacing.md,
    width: '48%',
  },
  serviceEmoji: {
    fontSize: 28,
  },
  serviceLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
