import { invokeAction } from "@/features/services/supabase-service-repository";

export type WithdrawalBalance = {
  availableMinor: number;
  walletAvailableMinor: number;
  enabled: boolean;
  baseFeeMinor: number;
  levyMinor: number;
  levyThresholdMinor: number;
};
export type WithdrawalBank = { code: string; name: string };
export type WithdrawalRecipient = {
  recipientToken: string;
  accountName: string;
  bankName: string;
  accountLastFour: string;
};
export type WithdrawalQuote = {
  quoteId: string;
  amountMinor: number;
  feeMinor: number;
  totalMinor: number;
  accountName: string;
  bankName: string;
  accountLastFour: string;
  expiresAt: string;
};
export type WithdrawalOrder = {
  id: string;
  transaction_id: string;
  status: "processing" | "pending" | "review" | "succeeded" | "failed";
  amount_minor: number;
  fee_minor: number;
  bank_name: string;
  account_last_four: string;
  status_message: string;
  created_at: string;
  completed_at: string | null;
};
export function withdrawalAmount(text: string): number | null {
  const value = text.replace(/,/g, "").trim();
  if (!/^\d{1,13}$/.test(value)) return null;
  const amount = BigInt(value) * 100n;
  return amount > 0 && amount <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(amount)
    : null;
}
export const withdrawalRepository = {
  balance: () => invokeAction<WithdrawalBalance>("withdrawal.balance"),
  banks: () => invokeAction<WithdrawalBank[]>("withdrawal.banks"),
  resolve: (bankCode: string, accountNumber: string) =>
    invokeAction<WithdrawalRecipient>("withdrawal.resolve", {
      bankCode,
      accountNumber,
    }),
  quote: (recipientToken: string, amountMinor: number) =>
    invokeAction<WithdrawalQuote>("withdrawal.quote", {
      recipientToken,
      amountMinor,
    }),
  submit: (input: { quoteId: string; pin: string; idempotencyKey: string }) =>
    invokeAction<WithdrawalOrder>("withdrawal.submit", input),
  orders: () => invokeAction<WithdrawalOrder[]>("withdrawal.orders"),
  refresh: (orderId: string) =>
    invokeAction<WithdrawalOrder>("withdrawal.refresh", { orderId }),
};
