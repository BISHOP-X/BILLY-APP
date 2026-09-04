import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { BillyLogo } from '@/components/ui/billy-logo';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { useTransactionQuery } from '@/features/main/queries';
import { formatFullDate, formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function ReceiptScreen() {
  const theme = useBillyTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useTransactionQuery(id);

  return (
    <AppScreen bottomSafe testID="receipt-screen">
      <ScreenHeader title="Receipt" />
      <DemoDataBanner />
      {query.isLoading ? (
        <SkeletonBlock style={{ height: 540 }} />
      ) : query.isError ? (
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message={query.error.message}
          onAction={() => void query.refetch()}
          title="Receipt unavailable"
          tone="danger"
        />
      ) : query.data?.receipt ? (
        <View
          style={[
            styles.receipt,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}>
          <View style={styles.brand}>
            <View style={[styles.logo, { backgroundColor: theme.colors.brand }]}>
              <BillyLogo size={43} />
            </View>
            <Text style={[styles.receiptTitle, { color: theme.colors.text }]}>
              Transaction receipt
            </Text>
            <View style={[styles.success, { backgroundColor: `${theme.colors.success}16` }]}>
              <Ionicons
                accessible={false}
                color={theme.colors.success}
                name="checkmark-circle"
                size={18}
              />
              <Text style={[styles.successText, { color: theme.colors.success }]}>
                {query.data.status === 'refunded' ? 'Refunded' : 'Successful'}
              </Text>
            </View>
          </View>
          <View style={[styles.divider, { borderColor: theme.colors.border }]} />
          <ReceiptRow label="Title" value={query.data.receipt.title} />
          <ReceiptRow
            label="Amount"
            value={formatMinorUnits(
              query.data.receipt.amountMinor,
              query.data.receipt.currency,
            )}
          />
          <ReceiptRow
            label="Total"
            value={formatMinorUnits(
              query.data.receipt.totalMinor,
              query.data.receipt.currency,
            )}
          />
          <ReceiptRow
            label="Fee"
            value={formatMinorUnits(
              query.data.receipt.feeMinor,
              query.data.receipt.currency,
            )}
          />
          <ReceiptRow label="Reference" value={query.data.receipt.reference} />
          <ReceiptRow label="Issued" value={formatFullDate(query.data.receipt.issuedAt)} />
          <View style={[styles.divider, { borderColor: theme.colors.border }]} />
          <Text style={[styles.note, { color: theme.colors.textMuted }]}>
            Keep the Billy reference when requesting support. This receipt contains no
            provider credentials or private payment details.
          </Text>
        </View>
      ) : (
        <StatePanel
          icon="document-text-outline"
          message="A receipt is issued only for an eligible final transaction state."
          title="Receipt not available"
        />
      )}
    </AppScreen>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  const theme = useBillyTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text selectable style={[styles.value, { color: theme.colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  divider: {
    borderTopWidth: 1,
    marginVertical: spacing.xs,
  },
  label: {
    fontFamily: typography.family,
    fontSize: 12,
  },
  logo: {
    alignItems: 'center',
    borderRadius: radii.lg,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  note: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  receipt: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  receiptTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 20,
    fontWeight: '800',
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  success: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  successText: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
  },
  value: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
});
