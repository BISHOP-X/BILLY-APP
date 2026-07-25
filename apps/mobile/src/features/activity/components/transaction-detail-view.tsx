import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';
import type { TransactionDetail } from '@/features/main/domain';
import {
  describeMinorUnits,
  formatFullDate,
  formatMinorUnits,
} from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export function TransactionDetailView({
  transaction,
}: {
  transaction: TransactionDetail;
}) {
  const theme = useBillyTheme();
  const signedAmount =
    transaction.direction === 'credit'
      ? transaction.totalMinor
      : -transaction.totalMinor;

  return (
    <>
      <View
        accessibilityLabel={`${transaction.title}, ${describeMinorUnits(
          signedAmount,
          transaction.currency,
        )}, status ${transaction.status}`}
        style={[
          styles.hero,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}>
        <View style={[styles.heroIcon, { backgroundColor: theme.colors.brandMist }]}>
          <Ionicons
            accessible={false}
            color={theme.colors.brand}
            name={
              transaction.direction === 'credit'
                ? 'arrow-down-outline'
                : 'arrow-up-outline'
            }
            size={28}
          />
        </View>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          numberOfLines={1}
          style={[styles.amount, { color: theme.colors.text }]}>
          {formatMinorUnits(signedAmount, transaction.currency, { sign: 'always' })}
        </Text>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          {transaction.title}
        </Text>
        <StatusChip status={transaction.status} />
      </View>

      <View
        style={[
          styles.details,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <DetailRow label="Reference" value={transaction.reference} />
        <DetailRow
          label="Amount"
          value={formatMinorUnits(transaction.amountMinor, transaction.currency)}
        />
        <DetailRow
          label="Fee"
          value={formatMinorUnits(transaction.feeMinor, transaction.currency)}
        />
        <DetailRow label="Date" value={formatFullDate(transaction.createdAt)} />
        <DetailRow label="Description" value={transaction.subtitle || transaction.kind} />
      </View>

      <View style={styles.timelineSection}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          Status timeline
        </Text>
        <View
          style={[
            styles.timeline,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}>
          {transaction.events.length ? (
            transaction.events.map((event, index) => (
              <View key={event.id} style={styles.event}>
                <View style={styles.eventTrack}>
                  <View style={[styles.eventDot, { backgroundColor: theme.colors.brand }]} />
                  {index < transaction.events.length - 1 ? (
                    <View style={[styles.eventLine, { backgroundColor: theme.colors.border }]} />
                  ) : null}
                </View>
                <View style={styles.eventCopy}>
                  <Text style={[styles.eventStatus, { color: theme.colors.text }]}>
                    {event.status.replace('_', ' ')}
                  </Text>
                  <Text style={[styles.eventMessage, { color: theme.colors.textMuted }]}>
                    {event.message}
                  </Text>
                  <Text style={[styles.eventDate, { color: theme.colors.textSoft }]}>
                    {formatFullDate(event.occurredAt)}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={[styles.eventMessage, { color: theme.colors.textMuted }]}>
              No additional status events are available yet.
            </Text>
          )}
        </View>
      </View>

      {transaction.receipt ? (
        <AppButton
          icon="document-text-outline"
          iconPosition="left"
          label="View receipt"
          onPress={() =>
            router.push({
              pathname: '/(app)/receipt/[id]',
              params: { id: transaction.id },
            })
          }
          variant="secondary"
        />
      ) : (
        <View
          style={[
            styles.receiptPending,
            { backgroundColor: theme.colors.surfaceMuted },
          ]}>
          <Ionicons
            accessible={false}
            color={theme.colors.textMuted}
            name="document-text-outline"
            size={20}
          />
          <Text style={[styles.receiptPendingText, { color: theme.colors.textMuted }]}>
            A receipt appears only after a final eligible transaction state.
          </Text>
        </View>
      )}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useBillyTheme();
  return (
    <View style={[styles.detailRow, { borderBottomColor: theme.colors.border }]}>
      <Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text selectable style={[styles.detailValue, { color: theme.colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  amount: {
    fontFamily: typography.familyRounded,
    fontSize: 30,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  detailLabel: {
    fontFamily: typography.family,
    fontSize: 12,
  },
  detailRow: {
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  detailValue: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  details: {
    borderRadius: radii.xl,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  event: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 88,
  },
  eventCopy: {
    flex: 1,
    gap: 4,
    paddingBottom: spacing.md,
  },
  eventDate: {
    fontFamily: typography.family,
    fontSize: 10,
  },
  eventDot: {
    borderRadius: radii.pill,
    height: 12,
    width: 12,
  },
  eventLine: {
    flex: 1,
    marginVertical: 4,
    width: 2,
  },
  eventMessage: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  eventStatus: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  eventTrack: {
    alignItems: 'center',
    width: 14,
  },
  hero: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.xl,
  },
  heroIcon: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 58,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 58,
  },
  receiptPending: {
    alignItems: 'center',
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  receiptPendingText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  sectionTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '800',
  },
  timeline: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing.lg,
  },
  timelineSection: {
    gap: spacing.md,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '700',
  },
});
