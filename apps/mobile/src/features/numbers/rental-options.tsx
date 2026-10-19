import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { ScalePressable } from '@/components/ui/motion';
import { useAuth } from '@/features/auth/auth-provider';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import {
  type NumberOrder,
  numberRepository,
  type NumberService,
} from './repository';

export type RentalMode = 'long' | 'shared' | 'reuse' | 'renew';
export function rentalPeriod(label?: string) {
  const match = /^(\d+)([dwmy])$/.exec(label ?? '');
  if (!match) return label ?? 'SMS';
  const unit = { d: 'day', w: 'week', m: 'month', y: 'year' }[match[2]];
  return `${match[1]} ${unit}${match[1] === '1' ? '' : 's'}`;
}
export function RentalOptions(
  { mode, order, onDone }: {
    mode: RentalMode;
    order?: NumberOrder;
    onDone: () => void;
  },
) {
  const theme = useBillyTheme(), { user } = useAuth(), qc = useQueryClient();
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const [basket, setBasket] = useState<NumberService[]>([]),
    [selected, setSelected] = useState<NumberService | null>(null);
  const [pin, setPin] = useState(''), [notice, setNotice] = useState('');
  const key = useRef(''), submitting = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const catalog = useQuery({
    queryKey: ['numbers', user?.id, 'extended', mode, order?.id, query, page],
    queryFn: async () => {
      if (mode === 'renew') {
        const r = await numberRepository.rentalOptions(order!.id);
        return { services: r.options, pages: 1 };
      }
      if (mode === 'reuse') {
        return numberRepository.reuseCatalog(order!.id, page, query);
      }
      return mode === 'long'
        ? numberRepository.longCatalog(page, query)
        : numberRepository.sharedCatalog(page, query);
    },
    staleTime: 30_000,
  });
  const purchase = useMutation({
    mutationFn: numberRepository.purchase,
    retry: false,
  });
  const bundle = useMutation({
    mutationFn: numberRepository.bundleQuote,
    retry: false,
  });
  const text = { color: theme.colors.text },
    muted = { color: theme.colors.textMuted };
  const card = [styles.card, {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  }];
  function choose(s: NumberService) {
    setSelected(s);
    setPin('');
    setNotice('');
    key.current = `rental-${Crypto.randomUUID()}`;
  }
  async function pay() {
    if (!selected || submitting.current) return;
    submitting.current = true;
    setNotice('');
    try {
      await purchase.mutateAsync({
        quoteToken: selected.quoteToken,
        pin,
        idempotencyKey: key.current,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['numbers', user?.id] }),
        qc.invalidateQueries({ queryKey: ['main'] }),
      ]);
      setPin('');
      onDone();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Check My numbers before trying again.',
      );
    } finally {
      submitting.current = false;
    }
  }
  return (
    <View style={styles.stack}>
      <Text style={[styles.title, text]}>
        {mode === 'long'
          ? 'Keep your number longer'
          : mode === 'shared'
          ? 'Several services. One number.'
          : mode === 'reuse'
          ? 'Use this number again'
          : 'Keep your number'}
      </Text>
      <Text style={[styles.body, muted]}>
        {mode === 'long'
          ? 'Choose a service and duration. Renew only when you choose to.'
          : mode === 'shared'
          ? 'Choose 2–5 services. We’ll find one US number that supports them all.'
          : mode === 'reuse'
          ? `${order?.phone_number} · Choose the service you need.`
          : `${order?.phone_number} · Available renewal and recovery options.`}
      </Text>
      {notice
        ? (
          <Text accessibilityLiveRegion='polite' style={[styles.body, text]}>
            {notice}
          </Text>
        )
        : null}
      {selected
        ? (
          <View style={card}>
            <Text style={[styles.title, text]}>{selected.name}</Text>
            <Text style={[styles.body, muted]}>
              {rentalPeriod(selected.periodLabel)}
            </Text>
            <Text style={[styles.price, text]}>
              {formatMinorUnits(selected.totalMinor, 'NGN')}
            </Text>
            <Text style={[styles.body, muted]}>
              Total price. No automatic renewals or extra charges.
            </Text>
            <Text style={[styles.body, muted]}>
              {selected.kind === 'short'
                ? 'Use the number promptly. A service is refunded only after cancellation is confirmed before a code arrives.'
                : 'Cancellation depends on the rental’s rules and whether messages have arrived. Recovery fees are non-refundable. Any refund must be confirmed.'}
            </Text>
            <TextField
              label='Transaction PIN'
              value={pin}
              onChangeText={(v) => setPin(v.replace(/\D/g, ''))}
              inputMode='numeric'
              maxLength={4}
              secureTextEntry
              placeholder='4 digits'
            />
            <AppButton
              label={selected.actionLabel ?? 'Pay and get number'}
              disabled={!/^\d{4}$/.test(pin)}
              loading={purchase.isPending}
              onPress={() => void pay()}
            />
            <AppButton
              label='Back to options'
              variant='ghost'
              disabled={purchase.isPending}
              onPress={() => {
                setSelected(null);
                setPin('');
              }}
            />
          </View>
        )
        : (
          <>
            {mode !== 'renew'
              ? (
                <TextField
                  label='Find your service'
                  value={search}
                  onChangeText={setSearch}
                  placeholder='Search services'
                  icon='search-outline'
                />
              )
              : null}
            {catalog.isPending
              ? <Text style={muted}>Loading options…</Text>
              : null}
            {catalog.error
              ? (
                <View style={card}>
                  <Text style={[styles.body, text]}>
                    {catalog.error.message}
                  </Text>
                  <AppButton
                    label='Try again'
                    variant='secondary'
                    onPress={() => void catalog.refetch()}
                  />
                </View>
              )
              : null}
            {mode === 'shared' && basket.length
              ? (
                <View style={card}>
                  <Text style={[styles.body, text]}>
                    {basket.map((s) => s.name).join(' + ')}
                  </Text>
                  <AppButton
                    label={`Review ${basket.length} services`}
                    disabled={basket.length < 2}
                    loading={bundle.isPending}
                    onPress={() => {
                      void bundle.mutateAsync(basket.map((s) => s.quoteToken))
                        .then(choose).catch((e) => setNotice(e.message));
                    }}
                  />
                  <AppButton
                    label='Clear selection'
                    variant='ghost'
                    onPress={() => setBasket([])}
                  />
                </View>
              )
              : null}
            {catalog.data?.services.map((s) => {
              const checked = basket.some((b) => b.name === s.name);
              return (
                <ScalePressable
                  key={`${s.name}-${s.periodLabel ?? ''}`}
                  accessibilityRole='button'
                  accessibilityState={{
                    disabled: s.available === false,
                    selected: checked,
                  }}
                  disabled={s.available === false}
                  style={[...card, styles.row]}
                  onPress={() => {
                    if (mode !== 'shared') choose(s);
                    else if (checked) {
                      setBasket((b) => b.filter((x) => x.name !== s.name));
                    } else if (basket.length < 5) setBasket((b) => [...b, s]);
                    else setNotice('You can choose up to five services.');
                  }}
                >
                  <View style={styles.label}>
                    <Text style={[styles.heading, text]}>
                      {checked ? '✓ ' : ''}
                      {s.name}
                    </Text>
                    <Text style={[styles.body, muted]}>
                      {s.available === false
                        ? `${rentalPeriod(s.periodLabel)} · Out of stock`
                        : `${s.actionLabel ? s.actionLabel + ' · ' : ''}${
                          rentalPeriod(s.periodLabel)
                        }`}
                    </Text>
                  </View>
                  <Text style={[styles.heading, text]}>
                    {formatMinorUnits(s.totalMinor, 'NGN')}
                  </Text>
                </ScalePressable>
              );
            })}
            {catalog.data && !catalog.data.services.length
              ? (
                <Text style={[styles.body, muted]}>
                  No options available right now. Try another service or check
                  again later.
                </Text>
              )
              : null}
            {catalog.data && catalog.data.pages > 1
              ? (
                <View style={styles.row}>
                  <AppButton
                    label='Previous'
                    variant='ghost'
                    disabled={page === 1}
                    onPress={() => setPage((p) => p - 1)}
                  />
                  <Text style={muted}>{page} / {catalog.data.pages}</Text>
                  <AppButton
                    label='Next'
                    variant='ghost'
                    disabled={page >= catalog.data.pages}
                    onPress={() => setPage((p) => p + 1)}
                  />
                </View>
              )
              : null}
          </>
        )}
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: 16 },
  card: { padding: 18, borderRadius: 20, borderWidth: 1, gap: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  label: { flex: 1, minWidth: 140 },
  title: { fontSize: 23, fontWeight: '700' },
  heading: { fontSize: 16, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 22 },
  price: { fontSize: 30, fontWeight: '700' },
});
