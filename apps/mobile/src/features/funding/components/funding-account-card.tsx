import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { BillyLogo } from '@/components/ui/billy-logo';
import { AppButton } from '@/components/ui/button';
import type { FundingAccount } from '@/features/services/domain';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

type FundingAccountCardProps = {
  account: FundingAccount;
  onCopy: () => void;
  onShare: () => void;
};

export function isReadyFundingAccount(
  account: FundingAccount | null,
): account is FundingAccount {
  return Boolean(
    account &&
      account.status === 'active' &&
      account.currency === 'NGN' &&
      account.isPermanent === true &&
      account.accountName.trim() &&
      /^paga$/i.test(account.bankName.trim()) &&
      /^\d{10}$/.test(account.accountNumber),
  );
}

export function FundingAccountCard({
  account,
  onCopy,
  onShare,
}: FundingAccountCardProps) {
  const spokenAccountNumber = account.accountNumber.split('').join(' ');

  return (
    <LinearGradient
      colors={['#082F1D', '#0D5330', '#238659']}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[styles.card, shadows.card]}
      testID="funding-account-card">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.glowLarge}
      />
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.glowSmall}
      />

      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <BillyLogo imageStyle={styles.logoImage} size={28} />
          </View>
          <View style={styles.brandCopy}>
            <Text style={styles.eyebrow}>BILLY</Text>
            <Text style={styles.title}>Funding Account</Text>
          </View>
        </View>
        <View
          accessibilityLabel="Funding account active"
          accessibilityRole="text"
          style={styles.status}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>ACTIVE</Text>
        </View>
      </View>

      <View style={styles.permanentPill}>
        <Ionicons accessible={false} color="#B8F3CF" name="infinite" size={17} />
        <Text style={styles.permanentText}>Reusable · No expiry</Text>
      </View>

      <View style={styles.accountPanel}>
        <View style={styles.bankRow}>
          <View style={styles.bankIcon}>
            <Ionicons accessible={false} color="#0D5330" name="business" size={18} />
          </View>
          <View style={styles.bankCopy}>
            <Text style={styles.metaLabel}>BANK</Text>
            <Text style={styles.bankName}>{account.bankName}</Text>
          </View>
          <Text style={styles.currency}>{account.currency}</Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.metaLabel}>ACCOUNT NUMBER</Text>
        <Text
          accessibilityLabel={`Funding account number ${spokenAccountNumber}`}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          numberOfLines={1}
          selectable
          style={styles.accountNumber}>
          {account.accountNumber}
        </Text>

        <View style={styles.nameRow}>
          <Text style={styles.metaLabel}>ACCOUNT NAME</Text>
          <Text numberOfLines={2} style={styles.accountName}>
            {account.accountName}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <View style={styles.action}>
          <AppButton
            accessibilityHint="Copies the ten-digit funding account number"
            icon="copy-outline"
            iconPosition="left"
            label="Copy number"
            onPress={onCopy}
            testID="copy-funding-account"
            variant="light"
          />
        </View>
        <View style={styles.action}>
          <AppButton
            accessibilityHint="Opens your device share sheet with these funding details"
            icon="share-social-outline"
            iconPosition="left"
            label="Share details"
            onPress={onShare}
            testID="share-funding-account"
            variant="secondary"
          />
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  accountName: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
    textAlign: 'right',
  },
  accountNumber: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 33,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    letterSpacing: 2.5,
    marginTop: spacing.xs,
  },
  accountPanel: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  action: {
    flexBasis: 170,
    flexGrow: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bankCopy: {
    flex: 1,
    gap: 2,
  },
  bankIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  bankName: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '800',
  },
  bankRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  brandCopy: {
    gap: 1,
  },
  card: {
    borderRadius: radii.xl,
    gap: spacing.lg,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  currency: {
    color: '#B8F3CF',
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  divider: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    height: 1,
    marginVertical: spacing.sm,
  },
  eyebrow: {
    color: '#B8F3CF',
    fontFamily: typography.familyRounded,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  glowLarge: {
    backgroundColor: 'rgba(184,243,207,0.08)',
    borderRadius: radii.pill,
    height: 240,
    position: 'absolute',
    right: -100,
    top: -110,
    width: 240,
  },
  glowSmall: {
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radii.pill,
    borderWidth: 1,
    bottom: -55,
    height: 150,
    left: -60,
    position: 'absolute',
    width: 150,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  logo: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  logoImage: {
    tintColor: '#FFFFFF',
  },
  metaLabel: {
    color: 'rgba(255,255,255,0.60)',
    fontFamily: typography.familyRounded,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.15,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  permanentPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(184,243,207,0.12)',
    borderColor: 'rgba(184,243,207,0.24)',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  permanentText: {
    color: '#DDFBE8',
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
  },
  status: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: spacing.xs,
    paddingVertical: 6,
  },
  statusDot: {
    backgroundColor: '#B8F3CF',
    borderRadius: radii.pill,
    height: 6,
    width: 6,
  },
  statusText: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  title: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '800',
  },
});
