import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AppButton } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { numberRepository, type NumberOrder } from './repository';
import { numberRefundMinor } from '@/features/services/order-status';
import { formatMinorUnits } from '@/features/wallet/money';
import { cacheNumberOrder } from './order-cache';

export function useTransactionNumbers(transactionIds: string[]) {
  const { user } = useAuth();
  const ids = [...new Set(transactionIds)].sort();
  return useQuery({
    queryKey: ['numbers', user?.id, 'transactions', ids.join(',')],
    enabled: !!user && ids.length > 0,
    queryFn: async () => {
      const orders: NumberOrder[] = [];
      for (let start = 0; start < ids.length; start += 100) orders.push(...(await numberRepository.forTransactions(ids.slice(start, start + 100))).orders);
      return orders;
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function canCancelNumber(order: NumberOrder) {
  // Legacy rentals predate can_cancel; the server still verifies eligibility.
  return order.status === 'waiting' && !order.rental_closed && !order.cancel_requested && order.can_cancel !== false && !order.sms_code;
}

export function NumberCancelAction({ order }: { order: NumberOrder }) {
  const { user } = useAuth();
  const qc = useQueryClient(), { colors } = useBillyTheme();
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false);
  const eligible = canCancelNumber(order);
  async function cancel() {
    if (lock.current || !eligible) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const result = await numberRepository.cancel(order.id);
      await cacheNumberOrder(qc, user?.id, result);
      setConfirm(false); setMessage(result.status_message);
      await Promise.all([qc.invalidateQueries({ queryKey: ['numbers'] }), qc.invalidateQueries({ queryKey: ['main'] })]);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not confirm cancellation. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const refund = numberRefundMinor(order);
  return <View style={{ gap: 10, paddingHorizontal: 12, paddingBottom: 12 }}>
    {refund > 0 ? <Text style={{ color: colors.text }}>Cancelled and refunded — {formatMinorUnits(refund, 'NGN')} returned to your Billy balance.</Text> : order.cancel_requested ? <Text style={{ color: colors.textMuted }}>Confirming cancellation and refund.</Text> : null}
    {eligible ? confirm ? <>
      <Text style={{ color: colors.text }}>Cancel this number? Stop using it after confirming. Any eligible refund returns once cancellation is confirmed.</Text>
      <AppButton label="Confirm cancellation" variant="refund" loading={busy} onPress={() => void cancel()} />
      <AppButton label="Keep number" variant="ghost" disabled={busy} onPress={() => setConfirm(false)} />
    </> : <AppButton label={order.rental_kind && order.rental_kind !== 'short' ? 'Cancel & request refund' : 'Cancel & refund'} variant="refund" onPress={() => setConfirm(true)} /> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textMuted }}>{message}</Text> : null}
  </View>;
}
