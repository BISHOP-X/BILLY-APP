import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { StatePanel } from '@/components/ui/state-panel';
import { ScalePressable } from '@/components/ui/motion';
import { useAuth } from '@/features/auth/auth-provider';
import {
  numberRepository,
  type NumberService,
  type NumberOrder,
} from '@/features/numbers/repository';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';

const terminal = new Set(['received', 'cancelled', 'failed']);
export default function ForeignNumbersScreen() {
  const theme = useBillyTheme();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'browse' | 'orders'>('browse');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [ordersPage, setOrdersPage] = useState(1);
  const [selection, setSelection] = useState<NumberService | null>(null);
  const [pin, setPin] = useState('');
  const [notice, setNotice] = useState('');
  const [cancelOrder, setCancelOrder] = useState<NumberOrder | null>(null);
  const key = useRef('');
  const busy = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const catalog = useQuery({
    queryKey: ['numbers', user?.id, 'catalog', page, query],
    queryFn: () => numberRepository.catalog(page, query),
    enabled: tab === 'browse',
    staleTime: 30_000,
  });
  const orders = useQuery({
    queryKey: ['numbers', user?.id, 'orders', ordersPage],
    queryFn: () => numberRepository.orders(ordersPage),
    refetchInterval: tab === 'orders' ? 10_000 : false,
  });
  const invalidate = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['numbers', user?.id, 'orders'] }),
      qc.invalidateQueries({ queryKey: ['main'] }),
    ]);
  }, [qc, user?.id]);
  const activeOrderIds = (orders.data?.orders ?? [])
    .filter((o) => !terminal.has(o.status))
    .slice(0, 4)
    .map((o) => o.id)
    .join(',');
  const purchase = useMutation({
    mutationFn: numberRepository.order,
    onSuccess: invalidate,
    retry: false,
  });
  const update = useMutation({
    mutationFn: async ({ id, cancel }: { id: string; cancel?: boolean }) =>
      cancel ? numberRepository.cancel(id) : numberRepository.refresh(id),
    onSuccess: invalidate,
    retry: false,
  });
  // Poll server-authoritative status while visible; background reconciliation also
  // continues independently. At most four active orders per foreground refresh.
  useEffect(() => {
    if (tab !== 'orders') return;
    let stopped = false;
    const timer = setInterval(() => {
      if (busy.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      const active = activeOrderIds ? activeOrderIds.split(',') : [];
      if (!active.length) return;
      busy.current = true;
      void Promise.all(
        active.map((id) => numberRepository.refresh(id).catch(() => null)),
      )
        .then(() => {
          if (!stopped) void invalidate();
        })
        .finally(() => {
          busy.current = false;
        });
    }, 12_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [activeOrderIds, tab, invalidate]);
  const card = [
    styles.card,
    { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
  ];
  const text = { color: theme.colors.text };
  const muted = { color: theme.colors.textMuted };
  async function pay() {
    if (!selection || purchase.isPending) return;
    setNotice('');
    try {
      const order = await purchase.mutateAsync({
        quoteToken: selection.quoteToken,
        pin,
        idempotencyKey: key.current,
      });
      setNotice(order.status_message);
      setSelection(null);
      setPin('');
      setTab('orders');
      setOrdersPage(1);
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : 'Check your orders before trying again.',
      );
    }
  }
  async function refresh(id: string, cancel = false) {
    try {
      const order = await update.mutateAsync({ id, cancel });
      setNotice(order.status_message);
      setCancelOrder(null);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : 'We could not refresh this order.',
      );
    }
  }
  async function copy(value: string) {
    try {
      await Clipboard.setStringAsync(value);
      setNotice('Copied to clipboard.');
    } catch {
      setNotice('Select and copy the number or code below.');
    }
  }
  return (
    <AppScreen
      bottomSafe
      contentStyle={styles.content}
      onRefresh={() => {
        void catalog.refetch();
        void orders.refetch();
      }}
      refreshing={catalog.isRefetching || orders.isRefetching}
    >
      <ScreenHeader
        title="US numbers"
        subtitle="One number. One service. Your code, right here."
      />
      <View
        style={[
          styles.intro,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={30}
          color={theme.colors.brand}
        />
        <Text style={[styles.heading, text]}>A number for your next step.</Text>
        <Text style={[styles.body, muted]}>
          Get a temporary US number to receive a verification code for your
          chosen service. No calls or permanent ownership. Acceptance is
          controlled by that service.
        </Text>
      </View>
      <View style={styles.tabs}>
        {(['browse', 'orders'] as const).map((item) => (
          <ScalePressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === item }}
            onPress={() => {
              setTab(item);
              setNotice('');
            }}
            style={[
              styles.tab,
              {
                backgroundColor:
                  tab === item ? theme.colors.brand : theme.colors.surface,
              },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === item ? '#07160D' : theme.colors.text },
              ]}
            >
              {item === 'browse' ? 'Get a number' : 'My numbers'}
            </Text>
          </ScalePressable>
        ))}
      </View>
      {notice ? (
        <View accessibilityLiveRegion="polite" style={card}>
          <Text style={[styles.body, text]}>{notice}</Text>
        </View>
      ) : null}
      {tab === 'browse' && !selection ? (
        <>
          <TextField
            label="Find your service"
            placeholder="Search by service name"
            value={search}
            onChangeText={setSearch}
            icon="search-outline"
          />
          {catalog.isPending ? (
            <StatePanel
              title="Finding available numbers"
              message="Checking current prices and availability."
              icon="hourglass-outline"
            />
          ) : catalog.error ? (
            <StatePanel
              title="Numbers unavailable"
              message={catalog.error.message}
              actionLabel="Try again"
              onAction={() => void catalog.refetch()}
              icon="cloud-offline-outline"
            />
          ) : null}
          {catalog.data?.services.map((s) => (
            <ScalePressable
              key={s.quoteToken}
              accessibilityRole="button"
              accessibilityLabel={`Get ${s.name} number for ${formatMinorUnits(s.totalMinor, 'NGN')}`}
              onPress={() => {
                setSelection(s);
                setPin('');
                setNotice('');
                key.current = `number-${Crypto.randomUUID()}`;
              }}
              style={[...card, styles.service]}
            >
              <View style={styles.serviceText}>
                <Text style={[styles.heading, text]}>{s.name}</Text>
                <Text style={[styles.body, muted]}>United States · SMS</Text>
              </View>
              <Text style={[styles.price, text]}>
                {formatMinorUnits(s.totalMinor, 'NGN')}
              </Text>
              <Ionicons
                name="chevron-forward"
                color={theme.colors.brand}
                size={18}
              />
            </ScalePressable>
          ))}
          {catalog.data && !catalog.data.services.length ? (
            <StatePanel
              title="No available numbers"
              message="Try another service or check again later."
              icon="search-outline"
            />
          ) : null}
          {catalog.data && catalog.data.pages > 1 ? (
            <View style={styles.pagination}>
              <AppButton
                label="Previous"
                disabled={page === 1}
                variant="ghost"
                onPress={() => setPage((p) => p - 1)}
              />
              <Text style={muted}>
                {page} / {catalog.data.pages}
              </Text>
              <AppButton
                label="Next"
                disabled={page >= catalog.data.pages}
                variant="ghost"
                onPress={() => setPage((p) => p + 1)}
              />
            </View>
          ) : null}
        </>
      ) : null}
      {tab === 'browse' && selection ? (
        <View style={card}>
          <Text style={[styles.eyebrow, { color: theme.colors.brand }]}>
            REVIEW YOUR NUMBER
          </Text>
          <Text style={[styles.heading, text]}>{selection.name}</Text>
          <Text style={[styles.total, text]}>
            {formatMinorUnits(selection.totalMinor, 'NGN')}
          </Text>
          <Text style={[styles.body, muted]}>
            Total, including fees. Your number is reserved for this service
            only. Request a code promptly after your number appears.
          </Text>
          <Text style={[styles.body, muted]}>
            Cancellation normally becomes available after five minutes. A refund
            is issued only when cancellation is confirmed, before a code
            arrives.
          </Text>
          <TextField
            label="Transaction PIN"
            placeholder="4 digits"
            secureTextEntry
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChangeText={(v) => setPin(v.replace(/\D/g, ''))}
          />
          <AppButton
            label="Pay and get number"
            loading={purchase.isPending}
            disabled={!/^\d{4}$/.test(pin)}
            onPress={() => void pay()}
          />
          <AppButton
            label="Choose another service"
            disabled={purchase.isPending}
            variant="ghost"
            onPress={() => {
              setSelection(null);
              setPin('');
            }}
          />
        </View>
      ) : null}
      {tab === 'orders' ? (
        <>
          {orders.error ? (
            <StatePanel
              title="Could not load your numbers"
              message={orders.error.message}
              actionLabel="Try again"
              onAction={() => void orders.refetch()}
              icon="cloud-offline-outline"
            />
          ) : orders.isPending ? (
            <StatePanel
              title="Loading your numbers"
              message="Your recent number requests will appear here."
              icon="hourglass-outline"
            />
          ) : !orders.data?.orders.length ? (
            <StatePanel
              title="Your numbers will appear here"
              message="Choose a service to get your first US SMS number."
              icon="chatbubbles-outline"
            />
          ) : null}
          {orders.data?.orders.map((o) => (
            <View key={o.id} style={card}>
              <View style={styles.service}>
                <Text style={[styles.heading, text]}>{o.service_name}</Text>
                <Text style={[styles.badge, { color: theme.colors.brand }]}>
                  {o.status.replaceAll('_', ' ')}
                </Text>
              </View>
              <Text style={[styles.body, muted]}>
                {formatMinorUnits(o.amount_minor + o.fee_minor, 'NGN')} ·{' '}
                {new Date(o.created_at).toLocaleDateString()}
              </Text>
              {o.phone_number ? (
                <>
                  <Text selectable style={[styles.number, text]}>
                    {o.phone_number}
                  </Text>
                  <AppButton
                    label="Copy number"
                    icon="copy-outline"
                    variant="ghost"
                    onPress={() => void copy(o.phone_number!)}
                  />
                </>
              ) : null}
              {o.sms_code ? (
                <View
                  style={[
                    styles.code,
                    { backgroundColor: theme.colors.surfaceMuted },
                  ]}
                >
                  <Text style={[styles.eyebrow, muted]}>
                    YOUR VERIFICATION CODE
                  </Text>
                  <Text selectable style={[styles.number, text]}>
                    {o.sms_code}
                  </Text>
                  <AppButton
                    label="Copy code"
                    variant="secondary"
                    onPress={() => void copy(o.sms_code!)}
                  />
                </View>
              ) : null}
              <Text style={[styles.body, muted]}>{o.status_message}</Text>
              {!terminal.has(o.status) ? (
                <>
                  <AppButton
                    label="Check for code"
                    variant="secondary"
                    loading={update.isPending}
                    onPress={() => void refresh(o.id)}
                  />
                  {o.status === 'waiting' && !o.cancel_requested ? (
                    <AppButton
                      label="Request cancellation"
                      variant="ghost"
                      onPress={() => setCancelOrder(o)}
                    />
                  ) : null}
                </>
              ) : null}
              {cancelOrder?.id === o.id ? (
                <View style={styles.confirm}>
                  <Text style={[styles.body, text]}>
                    Cancel this number? Do not use it after requesting
                    cancellation. Your payment returns after cancellation is
                    confirmed.
                  </Text>
                  <AppButton
                    label="Confirm cancellation"
                    loading={update.isPending}
                    onPress={() => void refresh(o.id, true)}
                  />
                  <AppButton
                    label="Keep number"
                    variant="ghost"
                    onPress={() => setCancelOrder(null)}
                  />
                </View>
              ) : null}
            </View>
          ))}
          <View style={styles.pagination}>
            <AppButton
              label="Previous"
              disabled={ordersPage === 1}
              variant="ghost"
              onPress={() => setOrdersPage((p) => p - 1)}
            />
            <AppButton
              label="Next"
              disabled={(orders.data?.orders.length ?? 0) < 25}
              variant="ghost"
              onPress={() => setOrdersPage((p) => p + 1)}
            />
          </View>
        </>
      ) : null}
    </AppScreen>
  );
}
const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: 32 },
  intro: { padding: 24, borderWidth: 1, borderRadius: 24, gap: 12 },
  card: { padding: 20, borderWidth: 1, borderRadius: 20, gap: 14 },
  heading: { fontSize: 18, fontWeight: '700', flexShrink: 1 },
  body: { fontSize: 14, lineHeight: 22 },
  tabs: { flexDirection: 'row', gap: 10 },
  tab: { flex: 1, padding: 14, borderRadius: 14, alignItems: 'center' },
  tabText: { fontWeight: '700' },
  service: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'space-between',
  },
  serviceText: { flex: 1, gap: 5 },
  price: { fontSize: 16, fontWeight: '700' },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  total: { fontSize: 34, fontWeight: '700' },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  number: { fontSize: 27, fontWeight: '700', letterSpacing: 1, flexShrink: 1 },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  code: { padding: 18, borderRadius: 14, gap: 12 },
  confirm: { gap: 12, paddingTop: 12 },
});
