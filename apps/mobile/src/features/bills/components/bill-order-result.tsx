import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { ScalePressable } from '@/components/ui/motion';
import type { BillOrder } from '@/features/services/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export function BillOrderResult({
  onAgain,
  onRefresh,
  order,
  refreshError,
  refreshing = false,
}: {
  onAgain: () => void;
  onRefresh: () => void;
  order: BillOrder;
  refreshError?: string | null;
  refreshing?: boolean;
}) {
  const theme = useBillyTheme();
  const [copied, setCopied] = useState(false);
  const pending = ['created', 'pending', 'processing', 'reserved'].includes(
    order.status,
  );
  const succeeded = order.status === 'succeeded';

  async function copyFulfillment() {
    if (!order.fulfillmentValue) return;
    await Clipboard.setStringAsync(order.fulfillmentValue);
    setCopied(true);
  }

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.statusIcon,
          {
            backgroundColor: succeeded
              ? `${theme.colors.success}16`
              : pending
                ? `${theme.colors.warning}16`
                : `${theme.colors.danger}16`,
          },
        ]}>
        <Ionicons
          color={
            succeeded
              ? theme.colors.success
              : pending
                ? theme.colors.warning
                : theme.colors.danger
          }
          name={
            succeeded
              ? 'checkmark-circle'
              : pending
                ? 'time'
                : 'alert-circle'
          }
          size={48}
        />
      </View>

      <View style={styles.headingCopy}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          {succeeded
            ? 'Payment complete'
            : pending
              ? 'Confirmation pending'
              : 'Payment not completed'}
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
          {succeeded
            ? `${order.serviceLabel} was completed successfully.`
            : pending
              ? 'Billy is checking the final provider status. Do not repeat this payment.'
              : 'No successful payment was recorded. Review Activity before trying again.'}
        </Text>
      </View>

      {order.isPreview ? (
        <FeedbackBanner message="Tester preview: this payment used synthetic provider evidence." />
      ) : null}
      {order.fulfillmentValue ? (
        <View
          style={[
            styles.fulfillment,
            {
              backgroundColor: theme.colors.brandMist,
              borderColor: theme.colors.border,
            },
          ]}>
          <Text style={[styles.fulfillmentLabel, { color: theme.colors.textMuted }]}>
            {order.fulfillmentLabel ?? 'Delivery code'}
          </Text>
          <Text selectable style={[styles.fulfillmentValue, { color: theme.colors.text }]}>
            {order.fulfillmentValue}
          </Text>
          {order.fulfillmentHint ? (
            <Text style={[styles.fulfillmentHint, { color: theme.colors.textMuted }]}>
              {order.fulfillmentHint}
            </Text>
          ) : null}
          <ScalePressable
            accessibilityLabel={`Copy ${order.fulfillmentLabel ?? 'delivery code'}`}
            accessibilityRole="button"
            onPress={() => void copyFulfillment()}
            style={[styles.copy, { backgroundColor: theme.colors.surface }]}>
            <Ionicons color={theme.colors.brand} name="copy-outline" size={18} />
            <Text style={[styles.copyText, { color: theme.colors.brand }]}>
              {copied ? 'Copied' : 'Copy'}
            </Text>
          </ScalePressable>
        </View>
      ) : null}

      {pending ? (
        <FeedbackBanner message="You can leave this screen. Billy will keep the payment in Activity until it reaches a final state." />
      ) : null}
      {pending && refreshError ? (
        <FeedbackBanner message={refreshError} tone="error" />
      ) : null}

      <View
        style={[
          styles.referenceCard,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <ResultRow label="Service" value={order.serviceLabel} />
        {order.productLabel ? (
          <ResultRow label="Product" value={order.productLabel} />
        ) : null}
        <ResultRow label="Customer" value={order.customerReference} />
        <ResultRow label="Billy reference" value={order.reference} />
      </View>

      <AppButton
        icon="receipt-outline"
        label="View activity"
        onPress={() => router.replace('/(app)/(tabs)/activity')}
      />
      {pending ? (
        <AppButton
          icon="refresh"
          label="Check payment status"
          loading={refreshing}
          onPress={onRefresh}
          variant="secondary"
        />
      ) : (
        <AppButton
          label="Make another payment"
          onPress={onAgain}
          variant="ghost"
        />
      )}
    </View>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  const theme = useBillyTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.colors.textMuted }]}>
        {label}
      </Text>
      <Text selectable style={[styles.rowValue, { color: theme.colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  copyText: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
  },
  fulfillment: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  fulfillmentHint: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  fulfillmentLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  fulfillmentValue: {
    fontFamily: typography.familyRounded,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  headingCopy: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  referenceCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontFamily: typography.family,
    fontSize: 12,
  },
  rowValue: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  statusIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radii.pill,
    height: 88,
    justifyContent: 'center',
    width: 88,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 440,
    textAlign: 'center',
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  wrapper: {
    gap: spacing.xl,
  },
});
