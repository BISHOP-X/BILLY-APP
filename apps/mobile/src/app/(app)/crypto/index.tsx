import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusChip } from '@/components/ui/status-chip';
import { TextField } from '@/components/ui/text-field';
import type {
  CryptoAddress,
  CryptoOperation,
  CryptoSendQuote,
  CryptoTradeQuote,
} from '@/features/crypto/domain';
import {
  useCryptoAssets,
  useCryptoOrders,
  useCryptoPortfolio,
  useCryptoSend,
  useCryptoSubmit,
} from '@/features/crypto/queries';
import { cryptoRepository } from '@/features/crypto/repository';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

const operations: {
  icon: keyof typeof Ionicons.glyphMap;
  key: CryptoOperation;
  label: string;
}[] = [
  { icon: 'add-circle-outline', key: 'buy', label: 'Buy' },
  { icon: 'arrow-down-circle-outline', key: 'receive', label: 'Receive' },
  { icon: 'remove-circle-outline', key: 'sell', label: 'Sell' },
  { icon: 'paper-plane-outline', key: 'send', label: 'Send' },
];

export default function CryptoScreen() {
  const theme = useBillyTheme();
  const [operation, setOperation] = useState<CryptoOperation>('buy');
  const assets = useCryptoAssets(operation);
  const portfolio = useCryptoPortfolio();
  const orders = useCryptoOrders();
  const submitTrade = useCryptoSubmit();
  const submitSend = useCryptoSend();
  const [assetIndex, setAssetIndex] = useState(0);
  const [networkIndex, setNetworkIndex] = useState(0);
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [destinationTag, setDestinationTag] = useState('');
  const [pin, setPin] = useState('');
  const [quote, setQuote] = useState<CryptoTradeQuote | CryptoSendQuote | null>(
    null,
  );
  const [receiveAddress, setReceiveAddress] = useState<CryptoAddress | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const currentAsset =
    assets.data?.assets[assetIndex] ?? assets.data?.assets[0];
  const currentNetwork =
    currentAsset?.networks[networkIndex] ?? currentAsset?.networks[0];
  const fiatInput = operation === 'buy';

  const totalPortfolio = useMemo(
    () =>
      portfolio.data?.assets.reduce(
        (count, candidate) => count + (Number(candidate.balance) > 0 ? 1 : 0),
        0,
      ) ?? 0,
    [portfolio.data],
  );

  const resetJourney = (next: CryptoOperation) => {
    setOperation(next);
    setAssetIndex(0);
    setNetworkIndex(0);
    setAmount('');
    setAddress('');
    setDestinationTag('');
    setPin('');
    setQuote(null);
    setReceiveAddress(null);
  };

  const handleContinue = async () => {
    if (!currentNetwork) return;
    setBusy(true);
    try {
      if (operation === 'receive') {
        setReceiveAddress(
          await cryptoRepository.receiveAddress(currentNetwork.selectionToken),
        );
      } else if (operation === 'buy') {
        const naira = Number(amount.replace(/,/g, ''));
        if (!Number.isFinite(naira) || naira <= 0) {
          throw new Error('Enter a valid Naira amount.');
        }
        setQuote(
          await cryptoRepository.buyQuote(
            currentNetwork.selectionToken,
            Math.round(naira * 100),
          ),
        );
      } else if (operation === 'sell') {
        setQuote(
          await cryptoRepository.sellQuote(
            currentNetwork.selectionToken,
            amount,
          ),
        );
      } else {
        setQuote(
          await cryptoRepository.sendQuote(
            currentNetwork.selectionToken,
            amount,
          ),
        );
      }
    } catch (error) {
      Alert.alert(
        'Could not continue',
        error instanceof Error ? error.message : 'Try again safely.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const idempotencyKey = `mobile-${operation}-${Crypto.randomUUID()}`;
      const order =
        operation === 'send'
          ? await submitSend.mutateAsync({
              address,
              destinationTag: destinationTag || undefined,
              idempotencyKey,
              pin,
              quoteId: quote.quoteId,
            })
          : await submitTrade.mutateAsync({
              action: operation as 'buy' | 'sell',
              idempotencyKey,
              pin,
              quoteId: quote.quoteId,
            });
      Alert.alert('Request received', order.statusMessage);
      setQuote(null);
      setPin('');
      setAmount('');
      setAddress('');
    } catch (error) {
      Alert.alert(
        'Transaction stopped safely',
        error instanceof Error
          ? error.message
          : 'No new transaction was created.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen
      bottomSafe
      contentStyle={styles.content}
      onRefresh={() => {
        void assets.refetch();
        void portfolio.refetch();
        void orders.refetch();
      }}
      refreshing={
        assets.isRefetching || portfolio.isRefetching || orders.isRefetching
      }
      testID="crypto-screen"
    >
      <ScreenHeader title="Crypto" subtitle="Powered securely through Billy" />
      <DemoDataBanner />

      <LinearGradient
        colors={['#071E14', '#0B4829', '#1A7B4A']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <View>
            <Text style={styles.eyebrow}>YOUR CRYPTO PORTFOLIO</Text>
            <Text style={styles.heroTitle}>
              {portfolio.isLoading
                ? 'Loading…'
                : `${totalPortfolio} active assets`}
            </Text>
          </View>
          <View style={styles.heroIcon}>
            <Ionicons color="#0B4829" name="logo-bitcoin" size={28} />
          </View>
        </View>
        <Text style={styles.heroBody}>
          Buy and sell to your Billy wallet, or receive and send on supported
          networks. Assets and fees refresh from the provider.
        </Text>
        <View style={styles.balanceRow}>
          {(portfolio.data?.assets ?? []).slice(0, 3).map((item) => (
            <View key={item.symbol} style={styles.balancePill}>
              <Text style={styles.balanceSymbol}>{item.symbol}</Text>
              <Text numberOfLines={1} style={styles.balanceAmount}>
                {item.balance}
              </Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      <View
        style={[styles.operationBar, { backgroundColor: theme.colors.surface }]}
      >
        {operations.map((item) => {
          const selected = operation === item.key;
          return (
            <View key={item.key} style={styles.operationSlot}>
              <ScalePressable
                accessibilityLabel={`${item.label} crypto`}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => resetJourney(item.key)}
                style={[
                  styles.operation,
                  selected && { backgroundColor: theme.colors.brand },
                ]}
              >
                <Ionicons
                  color={selected ? '#FFFFFF' : theme.colors.textMuted}
                  name={item.icon}
                  size={19}
                />
                <Text
                  style={[
                    styles.operationLabel,
                    { color: selected ? '#FFFFFF' : theme.colors.textMuted },
                  ]}
                >
                  {item.label}
                </Text>
              </ScalePressable>
            </View>
          );
        })}
      </View>

      {assets.isLoading ? (
        <>
          <SkeletonBlock style={styles.assetSkeleton} />
          <SkeletonBlock style={styles.formSkeleton} />
        </>
      ) : assets.isError || !assets.data ? (
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message={
            assets.error?.message ??
            'Billy could not load the current crypto assets.'
          }
          onAction={() => void assets.refetch()}
          title="Assets unavailable"
          tone="danger"
        />
      ) : (
        <FadeSlide key={operation} style={styles.journey}>
          <View style={styles.heading}>
            <Text style={[styles.title, { color: theme.colors.text }]}>
              {operations.find((item) => item.key === operation)?.label} crypto
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
              Choose the exact asset and network. Never send on a different
              network.
            </Text>
          </View>

          <View style={styles.assetRow}>
            {assets.data.assets.map((item, index) => (
              <ScalePressable
                accessibilityLabel={`Select ${item.name}`}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: currentAsset?.symbol === item.symbol,
                }}
                key={item.symbol}
                onPress={() => {
                  setAssetIndex(index);
                  setNetworkIndex(0);
                  setQuote(null);
                  setReceiveAddress(null);
                }}
                style={[
                  styles.asset,
                  {
                    backgroundColor:
                      currentAsset?.symbol === item.symbol
                        ? theme.colors.brandMist
                        : theme.colors.surface,
                    borderColor:
                      currentAsset?.symbol === item.symbol
                        ? theme.colors.brand
                        : theme.colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.coin,
                    {
                      backgroundColor: theme.colors.brand,
                    },
                  ]}
                >
                  <Text style={styles.coinText}>{item.symbol.slice(0, 1)}</Text>
                </View>
                <Text
                  style={[styles.assetSymbol, { color: theme.colors.text }]}
                >
                  {item.symbol}
                </Text>
                <Text
                  style={[
                    styles.assetName,
                    {
                      color: theme.colors.textMuted,
                    },
                  ]}
                >
                  {item.name}
                </Text>
              </ScalePressable>
            ))}
          </View>

          <View style={styles.networkRow}>
            {currentAsset?.networks.map((network, index) => (
              <ScalePressable
                accessibilityLabel={`Select ${network.name} network`}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: currentNetwork?.id === network.id,
                }}
                key={network.id}
                onPress={() => {
                  setNetworkIndex(index);
                  setQuote(null);
                  setReceiveAddress(null);
                }}
                style={[
                  styles.network,
                  {
                    backgroundColor:
                      currentNetwork?.id === network.id
                        ? theme.colors.brand
                        : theme.colors.surface,
                    borderColor:
                      currentNetwork?.id === network.id
                        ? theme.colors.brand
                        : theme.colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.networkText,
                    {
                      color:
                        currentNetwork?.id === network.id
                          ? '#FFFFFF'
                          : theme.colors.text,
                    },
                  ]}
                >
                  {network.name}
                </Text>
              </ScalePressable>
            ))}
          </View>

          {operation !== 'receive' && !quote ? (
            <View
              style={[
                styles.form,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <TextField
                inputMode="decimal"
                label={
                  fiatInput
                    ? 'Amount in Naira'
                    : `Amount in ${currentAsset?.symbol ?? 'crypto'}`
                }
                onChangeText={setAmount}
                placeholder={fiatInput ? 'e.g. 10,000' : 'e.g. 25.5'}
                value={amount}
              />
              {operation === 'send' ? (
                <>
                  <TextField
                    autoCapitalize="none"
                    label="Destination wallet address"
                    onChangeText={setAddress}
                    placeholder={`Paste a ${
                      currentNetwork?.name ?? ''
                    } address`}
                    value={address}
                  />
                  <TextField
                    autoCapitalize="none"
                    label="Memo or destination tag (if required)"
                    onChangeText={setDestinationTag}
                    placeholder="Optional"
                    value={destinationTag}
                  />
                </>
              ) : null}
              <AppButton
                disabled={
                  !amount.trim() || (operation === 'send' && !address.trim())
                }
                label="Get live quote"
                loading={busy}
                onPress={() => void handleContinue()}
              />
            </View>
          ) : null}

          {operation === 'receive' && !receiveAddress ? (
            <View
              style={[
                styles.form,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Ionicons
                color={theme.colors.brand}
                name="qr-code-outline"
                size={32}
              />
              <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
                Your permanent receive address
              </Text>
              <Text
                style={[styles.subtitle, { color: theme.colors.textMuted }]}
              >
                Billy creates or reuses the address assigned to your account for
                this exact network.
              </Text>
              <AppButton
                label="Show receive address"
                loading={busy}
                onPress={() => void handleContinue()}
              />
            </View>
          ) : null}

          {receiveAddress ? (
            <View
              style={[
                styles.addressCard,
                {
                  backgroundColor: theme.colors.brandMist,
                  borderColor: theme.colors.brand,
                },
              ]}
            >
              <Ionicons
                color={theme.colors.brand}
                name="shield-checkmark"
                size={28}
              />
              <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
                {receiveAddress.asset} on {currentNetwork?.name}
              </Text>
              <Text
                selectable
                style={[styles.address, { color: theme.colors.text }]}
              >
                {receiveAddress.address ?? 'Address is still being prepared'}
              </Text>
              {receiveAddress.destinationTag ? (
                <Text
                  style={[
                    styles.subtitle,
                    {
                      color: theme.colors.textMuted,
                    },
                  ]}
                >
                  Memo/tag: {receiveAddress.destinationTag}
                </Text>
              ) : null}
              {receiveAddress.address ? (
                <AppButton
                  icon="copy-outline"
                  label="Copy address"
                  onPress={() => {
                    void Clipboard.setStringAsync(receiveAddress.address!);
                    Alert.alert('Copied', 'Receive address copied securely.');
                  }}
                  variant="secondary"
                />
              ) : null}
              <Text style={[styles.warning, { color: theme.colors.warning }]}>
                Only send {receiveAddress.asset} on {currentNetwork?.name}. A
                different asset or network can be permanently lost.
              </Text>
            </View>
          ) : null}

          {quote ? (
            <View
              style={[
                styles.quote,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <View style={styles.quoteTop}>
                <View>
                  <Text
                    style={[styles.cardTitle, { color: theme.colors.text }]}
                  >
                    Review {operation}
                  </Text>
                  <Text
                    style={[
                      styles.subtitle,
                      {
                        color: theme.colors.textMuted,
                      },
                    ]}
                  >
                    {quote.asset} · {currentNetwork?.name}
                  </Text>
                </View>
                <Ionicons
                  color={theme.colors.brand}
                  name="shield-checkmark"
                  size={28}
                />
              </View>
              <QuoteRow
                label="Crypto amount"
                value={`${quote.tokenAmount} ${quote.asset}`}
              />
              {'fiatAmountMinor' in quote ? (
                <>
                  <QuoteRow
                    label={
                      operation === 'sell' ? 'Wallet payout' : 'Buy amount'
                    }
                    value={formatMinorUnits(quote.fiatAmountMinor)}
                  />
                  <QuoteRow
                    label="Fees"
                    value={formatMinorUnits(quote.feeMinor)}
                  />
                  {quote.totalMinor ? (
                    <QuoteRow
                      label="Total debit"
                      value={formatMinorUnits(quote.totalMinor)}
                      strong
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <QuoteRow
                    label="Network fee"
                    value={`${quote.networkFee} ${quote.asset}`}
                  />
                  <QuoteRow
                    label="Available"
                    value={`${quote.availableBalance} ${quote.asset}`}
                  />
                </>
              )}
              {operation === 'send' ? (
                <QuoteRow label="Destination" value={address} />
              ) : null}
              <TextField
                inputMode="numeric"
                label="6-digit transaction PIN"
                maxLength={6}
                onChangeText={(value) => setPin(value.replace(/\D/g, ''))}
                placeholder="••••••"
                secureTextEntry
                value={pin}
              />
              <AppButton
                disabled={pin.length !== 6}
                label={`Confirm ${operation}`}
                loading={busy}
                onPress={() => void handleConfirm()}
              />
              <AppButton
                label="Change details"
                onPress={() => {
                  setQuote(null);
                  setPin('');
                }}
                variant="ghost"
              />
            </View>
          ) : null}
        </FadeSlide>
      )}

      {orders.data?.length ? (
        <View style={styles.orders}>
          <View style={styles.heading}>
            <Text style={[styles.title, { color: theme.colors.text }]}>
              Recent crypto activity
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
              Provider confirmations and pending transfers remain visible here.
            </Text>
          </View>
          {orders.data.slice(0, 5).map((order) => (
            <View
              key={order.id}
              style={[
                styles.order,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.orderIcon,
                  {
                    backgroundColor: theme.colors.brandMist,
                  },
                ]}
              >
                <Ionicons
                  color={theme.colors.brand}
                  name={
                    order.action === 'send'
                      ? 'paper-plane-outline'
                      : 'swap-horizontal-outline'
                  }
                  size={20}
                />
              </View>
              <View style={styles.orderCopy}>
                <Text style={[styles.orderTitle, { color: theme.colors.text }]}>
                  {order.action.toUpperCase()} {order.tokenAmount} {order.asset}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.orderBody,
                    {
                      color: theme.colors.textMuted,
                    },
                  ]}
                >
                  {order.statusMessage}
                </Text>
              </View>
              <StatusChip
                status={
                  order.status === 'awaiting_transfer'
                    ? 'pending'
                    : order.status
                }
              />
            </View>
          ))}
        </View>
      ) : null}
    </AppScreen>
  );
}

function QuoteRow({
  label,
  strong = false,
  value,
}: {
  label: string;
  strong?: boolean;
  value: string;
}) {
  const theme = useBillyTheme();
  return (
    <View style={styles.quoteRow}>
      <Text style={[styles.quoteLabel, { color: theme.colors.textMuted }]}>
        {label}
      </Text>
      <Text
        numberOfLines={2}
        style={[
          styles.quoteValue,
          { color: strong ? theme.colors.brand : theme.colors.text },
          strong && styles.strong,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  address: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  addressCard: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xl,
  },
  asset: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: 3,
    minWidth: 92,
    padding: spacing.md,
  },
  assetName: {
    fontFamily: typography.family,
    fontSize: 10,
  },
  assetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  assetSkeleton: { height: 112 },
  assetSymbol: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '900',
  },
  balanceAmount: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: typography.family,
    fontSize: 10,
  },
  balancePill: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radii.md,
    flex: 1,
    gap: 2,
    minWidth: 76,
    padding: spacing.sm,
  },
  balanceRow: { flexDirection: 'row', gap: spacing.sm },
  balanceSymbol: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '900',
  },
  cardTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '800',
  },
  coin: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  coinText: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '900',
  },
  content: { gap: spacing.lg },
  eyebrow: {
    color: '#A9EAC6',
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  form: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  formSkeleton: { height: 280 },
  heading: { gap: 4 },
  hero: {
    borderRadius: radii.xl,
    gap: spacing.md,
    minHeight: 210,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  heroBody: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  heroTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  journey: { gap: spacing.lg },
  network: {
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  networkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  networkText: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
  },
  operation: {
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    gap: 3,
    minHeight: 60,
    justifyContent: 'center',
  },
  operationBar: {
    borderRadius: radii.xl,
    flexDirection: 'row',
    gap: 4,
    padding: 5,
  },
  operationLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
  },
  operationSlot: { flex: 1 },
  order: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  orderBody: { fontFamily: typography.family, fontSize: 11, lineHeight: 16 },
  orderCopy: { flex: 1, gap: 3 },
  orderIcon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  orderTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  orders: { gap: spacing.md },
  quote: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  quoteLabel: { fontFamily: typography.family, fontSize: 12 },
  quoteRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  quoteTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quoteValue: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  strong: { fontSize: 16, fontWeight: '900' },
  subtitle: { fontFamily: typography.family, fontSize: 13, lineHeight: 19 },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  warning: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
});
