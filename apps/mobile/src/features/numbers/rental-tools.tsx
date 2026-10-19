import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { type NumberOrder, numberRepository } from './repository';
import type { RentalMode } from './rental-options';

export function RentalTools(
  { order, onOptions }: {
    order: NumberOrder;
    onOptions: (mode: RentalMode, order: NumberOrder) => void;
  },
) {
  const theme = useBillyTheme(), { user } = useAuth(), qc = useQueryClient();
  const [showMessages, setShowMessages] = useState(false),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(1),
    [confirmFinish, setConfirmFinish] = useState(false);
  const lock = useRef(false);
  const long = !!order.rental_kind && order.rental_kind !== 'short';
  const messages = useQuery({
    queryKey: ['numbers', user?.id, 'messages', order.id, page],
    queryFn: () => numberRepository.messages(order.id, page),
    enabled: showMessages,
    refetchInterval: showMessages && !order.rental_closed ? 15_000 : false,
  });
  async function perform(action: 'another' | 'finish') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice('');
    try {
      const next = await numberRepository[action](order.id);
      setNotice(next.status_message);
      setConfirmFinish(false);
      await qc.invalidateQueries({ queryKey: ['numbers', user?.id, 'orders'] });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={styles.stack}>
      {order.rental_end
        ? (
          <Text style={{ color: theme.colors.textMuted }}>
            Rental end: {order.rental_end.split(/[ T]/)[0]}
          </Text>
        )
        : null}
      {notice
        ? (
          <Text
            accessibilityLiveRegion='polite'
            style={{ color: theme.colors.text }}
          >
            {notice}
          </Text>
        )
        : null}
      <AppButton
        label={showMessages ? 'Hide messages' : 'Message history'}
        variant='ghost'
        onPress={() => setShowMessages((v) => !v)}
      />
      {showMessages
        ? (
          <View style={styles.stack}>
            {messages.isPending
              ? (
                <Text style={{ color: theme.colors.textMuted }}>
                  Loading messages…
                </Text>
              )
              : null}
            {messages.error
              ? (
                <Text style={{ color: theme.colors.text }}>
                  {messages.error.message}
                </Text>
              )
              : null}
            {messages.data?.messages.map((m) => (
              <View
                key={m.id}
                style={[styles.message, {
                  backgroundColor: theme.colors.surfaceMuted,
                }]}
              >
                <Text style={{ color: theme.colors.textMuted }}>
                  {m.sender || 'SMS'} ·{' '}
                  {new Date(m.received_at ?? m.created_at).toLocaleString()}
                </Text>
                <Text
                  selectable
                  style={[styles.body, { color: theme.colors.text }]}
                >
                  {m.body}
                </Text>
              </View>
            ))}
            {messages.data && !messages.data.messages.length
              ? (
                <Text style={{ color: theme.colors.textMuted }}>
                  No messages yet.
                </Text>
              )
              : null}
            {page > 1
              ? (
                <AppButton
                  label='Newer messages'
                  variant='ghost'
                  onPress={() => setPage((p) => p - 1)}
                />
              )
              : null}
            {messages.data?.messages.length === 50
              ? (
                <AppButton
                  label='Older messages'
                  variant='ghost'
                  onPress={() => setPage((p) => p + 1)}
                />
              )
              : null}
          </View>
        )
        : null}
      {long && order.phone_number && order.operation !== 'renew'
        ? (
          <AppButton
            label={order.rental_closed ? 'Recovery options' : 'Renew number'}
            variant='secondary'
            onPress={() => onOptions('renew', order)}
          />
        )
        : null}
      {!long && order.supports_extras && order.phone_number
        ? (
          <>
            {order.sms_code && !order.rental_closed
              ? (
                <>
                  <AppButton
                    label={order.awaiting_another
                      ? 'Waiting for another code'
                      : 'Receive another code'}
                    variant='secondary'
                    disabled={order.awaiting_another}
                    loading={busy}
                    onPress={() => void perform('another')}
                  />
                  <AppButton
                    label='Finish rental'
                    variant='ghost'
                    disabled={busy}
                    onPress={() => setConfirmFinish(true)}
                  />
                  {confirmFinish
                    ? (
                      <View style={styles.stack}>
                        <Text style={{ color: theme.colors.text }}>
                          Finish this rental? It will stop receiving codes.
                        </Text>
                        <AppButton
                          label='Finish'
                          loading={busy}
                          onPress={() => void perform('finish')}
                        />
                        <AppButton
                          label='Keep receiving'
                          variant='ghost'
                          onPress={() => setConfirmFinish(false)}
                        />
                      </View>
                    )
                    : null}
                </>
              )
              : null}
            <AppButton
              label='Use number for a service'
              variant='ghost'
              onPress={() => onOptions('reuse', order)}
            />
          </>
        )
        : null}
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: 12 },
  message: { padding: 14, borderRadius: 12, gap: 8 },
  body: { fontSize: 16, lineHeight: 24 },
});
