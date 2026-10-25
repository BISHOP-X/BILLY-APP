import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { AppScreen } from "@/components/layout/app-screen";
import { AppButton } from "@/components/ui/button";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import { ScalePressable } from "@/components/ui/motion";
import { ScreenHeader } from "@/components/ui/screen-header";
import { StatePanel } from "@/components/ui/state-panel";
import { TextField } from "@/components/ui/text-field";
import { useAuth } from "@/features/auth/auth-provider";
import {
  isCompleteTransactionPin,
  normalizeTransactionPin,
  TRANSACTION_PIN_INPUT_MAX_LENGTH,
} from "@/features/security/transaction-pin";
import { formatMinorUnits } from "@/features/wallet/money";
import {
  withdrawalAmount,
  type WithdrawalBank,
  type WithdrawalOrder,
  type WithdrawalQuote,
  type WithdrawalRecipient,
  withdrawalRepository as api,
} from "@/features/wallet/withdrawal-repository";
import { useBillyTheme } from "@/hooks/use-billy-theme";
import { radii, spacing, typography } from "@/theme/tokens";

export default function WithdrawScreen() {
  const theme = useBillyTheme(), { user } = useAuth(), cache = useQueryClient();
  const key = ["withdrawal", user?.id];
  const balance = useQuery({
    queryKey: [...key, "balance"],
    queryFn: api.balance,
  });
  const banks = useQuery({
    queryKey: [...key, "banks"],
    queryFn: api.banks,
    enabled: balance.data?.enabled === true,
    staleTime: 300_000,
  });
  const history = useQuery({
    queryKey: [...key, "orders"],
    queryFn: api.orders,
    refetchInterval: (q) =>
      AppState.currentState === "active" &&
        q.state.data?.some((o) => !["succeeded", "failed"].includes(o.status))
        ? 15_000
        : false,
  });
  const [bank, setBank] = useState<WithdrawalBank | null>(null),
    [bankSearch, setBankSearch] = useState(""),
    [picker, setPicker] = useState(false);
  const [account, setAccount] = useState(""),
    [recipient, setRecipient] = useState<WithdrawalRecipient | null>(null),
    [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<WithdrawalQuote | null>(null),
    [pin, setPin] = useState(""),
    [order, setOrder] = useState<WithdrawalOrder | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const requestKey = useRef(""), inFlight = useRef(false);
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: key }),
      cache.invalidateQueries({ queryKey: ["main"] }),
    ]);
  };
  const perform = async (job: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const clearRecipient = () => {
    setRecipient(null);
    setQuote(null);
    setPin("");
  };
  const back = () => {
    if (quote && !submitted) {
      setQuote(null);
      setPin("");
      return;
    }
    if (picker) {
      setPicker(false);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  };
  const card = {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  };
  const text = { color: theme.colors.text },
    muted = { color: theme.colors.textMuted };
  const pendingOrder = order
    ? history.data?.find((o) => o.id === order.id) ?? order
    : null;
  const row = (label: string, value: string, strong = false) => (
    <View key={label} style={styles.row}>
      <Text style={[styles.body, muted]}>{label}</Text>
      <Text style={[styles.value, text, strong && styles.strong]}>{value}</Text>
    </View>
  );
  return (
    <AppScreen
      bottomSafe
      testID="withdraw-screen"
      refreshing={balance.isRefetching}
      onRefresh={() => void refresh()}
    >
      <ScreenHeader
        title="Withdraw"
        subtitle="From your crypto and gift-card sales"
        onBack={back}
      />
      <View style={[styles.balance, card]}>
        <Text style={[styles.body, muted]}>Available to withdraw</Text>
        <Text style={[styles.amount, text]}>
          {formatMinorUnits(balance.data?.availableMinor ?? 0)}
        </Text>
        <Text style={[styles.small, muted]}>
          Completed sales become available here. Wallet top-ups are for
          purchases.
        </Text>
      </View>
      {error ? <FeedbackBanner tone="error" message={error} /> : null}
      {pendingOrder
        ? (
          <View style={[styles.card, card]}>
            <Ionicons
              name={pendingOrder.status === "succeeded"
                ? "checkmark-circle"
                : "time-outline"}
              size={42}
              color={pendingOrder.status === "succeeded"
                ? theme.colors.success
                : theme.colors.warning}
            />
            <Text style={[styles.title, text]}>
              {pendingOrder.status === "succeeded"
                ? "Withdrawal complete"
                : "Withdrawal submitted"}
            </Text>
            <Text style={[styles.body, muted]}>
              {pendingOrder.status_message}
            </Text>
            {row("Amount", formatMinorUnits(pendingOrder.amount_minor), true)}
            {row("Bank", pendingOrder.bank_name)}
            {row("Account", `•••• ${pendingOrder.account_last_four}`)}
            <AppButton
              label="View receipt"
              onPress={() =>
                router.push({
                  pathname: "/(app)/transaction/[id]",
                  params: { id: pendingOrder.transaction_id },
                })}
            />
            {!["succeeded", "failed"].includes(pendingOrder.status)
              ? (
                <AppButton
                  label="Check status"
                  loading={busy}
                  variant="ghost"
                  onPress={() =>
                    void perform(async () => {
                      setOrder(await api.refresh(pendingOrder.id));
                      await refresh();
                    })}
                />
              )
              : null}
            <AppButton
              label="Done"
              variant="ghost"
              onPress={() => router.replace("/home")}
            />
          </View>
        )
        : quote
        ? (
          <View style={[styles.card, card]}>
            <Text style={[styles.title, text]}>Review withdrawal</Text>
            {row("Account name", quote.accountName)}
            {row("Bank", quote.bankName)}
            {row("Account", `•••• ${quote.accountLastFour}`)}
            {row("You receive", formatMinorUnits(quote.amountMinor), true)}
            {row("Transfer fee", formatMinorUnits(quote.feeMinor))}
            {row("Total", formatMinorUnits(quote.totalMinor), true)}
            <Text style={[styles.small, muted]}>
              Usually instant. Some banks can take up to 24 hours.
            </Text>
            <TextField
              label="Transaction PIN"
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={TRANSACTION_PIN_INPUT_MAX_LENGTH}
              secureTextEntry
              autoComplete="off"
              value={pin}
              onChangeText={(v) => setPin(normalizeTransactionPin(v))}
            />
            {submitted
              ? (
                <FeedbackBanner
                  tone="warning"
                  message="If the connection dropped, check your withdrawals below. Retrying uses the same request."
                />
              )
              : null}
            <AppButton
              label={submitted ? "Check my withdrawal" : "Confirm withdrawal"}
              icon="arrow-up-outline"
              loading={busy}
              disabled={!isCompleteTransactionPin(pin) && !submitted}
              onPress={() =>
                void perform(async () => {
                  setSubmitted(true);
                  try {
                    const result = await api.submit({
                      quoteId: quote.quoteId,
                      pin,
                      idempotencyKey: requestKey.current,
                    });
                    setPin("");
                    setOrder(result);
                    await refresh();
                  } catch (e) {
                    if (
                      e && typeof e === "object" && "code" in e &&
                      ["forbidden", "invalid_request", "conflict"].includes(
                        String(e.code),
                      )
                    ) setSubmitted(false);
                    throw e;
                  }
                })}
            />
            {!submitted
              ? (
                <AppButton
                  label="Change details"
                  variant="ghost"
                  onPress={() => {
                    setQuote(null);
                    setPin("");
                  }}
                />
              )
              : null}
          </View>
        )
        : (
          <>
            {balance.isError
              ? (
                <StatePanel
                  title="Could not load your balance"
                  message={balance.error.message}
                  actionLabel="Try again"
                  onAction={() => void balance.refetch()}
                  icon="cloud-offline-outline"
                />
              )
              : null}
            {balance.data && !balance.data.enabled
              ? (
                <FeedbackBanner message="Bank withdrawals are being connected. Your sale proceeds stay in Billy." />
              )
              : null}
            <View style={[styles.card, card]}>
              <Text style={[styles.title, text]}>Bank account</Text>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="Choose bank"
                disabled={busy || !balance.data?.enabled}
                onPress={() => setPicker((v) => !v)}
                style={[styles.bankButton, {
                  borderColor: theme.colors.border,
                }]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.body, text, { flex: 1 }]}
                >
                  {bank?.name ?? "Choose your bank"}
                </Text>
                <Ionicons
                  name={picker ? "chevron-up" : "chevron-down"}
                  color={theme.colors.textMuted}
                  size={18}
                />
              </ScalePressable>
              {picker
                ? (
                  <View style={styles.bankList}>
                    <TextField
                      label="Search banks"
                      value={bankSearch}
                      onChangeText={setBankSearch}
                      icon="search-outline"
                    />
                    {banks.isPending
                      ? (
                        <Text style={[styles.small, muted]}>
                          Loading banks…
                        </Text>
                      )
                      : null}
                    {banks.isError
                      ? (
                        <AppButton
                          label="Reload banks"
                          variant="ghost"
                          onPress={() => void banks.refetch()}
                        />
                      )
                      : null}
                    {(banks.data ?? []).filter((b) =>
                      b.name.toLowerCase().includes(
                        bankSearch.trim().toLowerCase(),
                      )
                    ).slice(0, 40).map((b) => (
                      <ScalePressable
                        key={b.code}
                        accessibilityRole="button"
                        accessibilityLabel={b.name}
                        onPress={() => {
                          setBank(b);
                          setPicker(false);
                          clearRecipient();
                        }}
                        style={styles.bankOption}
                      >
                        <Text style={[styles.body, text]}>{b.name}</Text>
                      </ScalePressable>
                    ))}
                  </View>
                )
                : null}
              <TextField
                label="Account number"
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={10}
                value={account}
                onChangeText={(v) => {
                  setAccount(v.replace(/\D/g, "").slice(0, 10));
                  clearRecipient();
                }}
                disabled={busy}
              />
              {recipient
                ? (
                  <View
                    style={[styles.verified, {
                      backgroundColor: theme.colors.brandMist,
                    }]}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={theme.colors.brand}
                    />
                    <Text style={[styles.value, text, { flex: 1 }]}>
                      {recipient.accountName}
                    </Text>
                  </View>
                )
                : (
                  <AppButton
                    label="Verify account"
                    loading={busy}
                    disabled={!bank || account.length !== 10 ||
                      !balance.data?.enabled}
                    variant="ghost"
                    onPress={() =>
                      void perform(async () => {
                        setRecipient(await api.resolve(bank!.code, account));
                      })}
                  />
                )}
              <TextField
                label="Amount to receive (NGN)"
                keyboardType="number-pad"
                inputMode="numeric"
                value={amount}
                onChangeText={setAmount}
                placeholder="e.g. 10,000"
              />
              <AppButton
                label="Continue"
                loading={busy}
                disabled={!recipient || !withdrawalAmount(amount) ||
                  !balance.data?.enabled}
                onPress={() =>
                  void perform(async () => {
                    const amountMinor = withdrawalAmount(amount);
                    if (!recipient || !amountMinor) return;
                    setQuote(
                      await api.quote(recipient.recipientToken, amountMinor),
                    );
                    requestKey.current = `withdraw-${Crypto.randomUUID()}`;
                    setSubmitted(false);
                  })}
              />
            </View>
          </>
        )}
      {!!history.data?.length
        ? (
          <View style={styles.history}>
            <Text style={[styles.title, text]}>Your withdrawals</Text>
            {history.data.map((item) => (
              <ScalePressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.bank_name}, ${item.status}, ${
                  formatMinorUnits(item.amount_minor)
                }`}
                onPress={() => {
                  setOrder(item);
                  setQuote(null);
                  setPin("");
                }}
                style={[styles.historyItem, card]}
              >
                <Ionicons
                  name="arrow-up-circle-outline"
                  size={28}
                  color={theme.colors.brand}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.value, text]}>
                    {item.bank_name} · {item.account_last_four}
                  </Text>
                  <Text style={[styles.small, muted]}>
                    {item.status === "review"
                      ? "Confirming transfer"
                      : item.status === "succeeded"
                      ? "Completed"
                      : "Processing"}
                  </Text>
                </View>
                <Text style={[styles.value, text]}>
                  {formatMinorUnits(item.amount_minor)}
                </Text>
              </ScalePressable>
            ))}
          </View>
        )
        : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  balance: {
    padding: spacing.xl,
    borderWidth: 1,
    borderRadius: radii.xl,
    gap: 8,
  },
  amount: {
    fontFamily: typography.familyRounded,
    fontSize: 32,
    fontWeight: "800",
  },
  card: {
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radii.xl,
    gap: spacing.lg,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 19,
    fontWeight: "800",
  },
  body: { fontFamily: typography.family, fontSize: 14, lineHeight: 21 },
  small: { fontFamily: typography.family, fontSize: 12, lineHeight: 18 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  value: {
    fontFamily: typography.family,
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
  },
  strong: { fontWeight: "800", fontSize: 16 },
  bankButton: {
    minHeight: 52,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bankList: { gap: 4 },
  bankOption: { paddingVertical: 13, paddingHorizontal: 4, minHeight: 44 },
  verified: {
    padding: 14,
    borderRadius: radii.md,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  history: { gap: 12 },
  historyItem: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
