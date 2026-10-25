import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WithdrawScreen from "@/app/(app)/wallet/withdraw";
import {
  withdrawalAmount,
  withdrawalRepository as api,
} from "@/features/wallet/withdrawal-repository";
import { ServiceApiError } from "@/features/services/domain";
jest.mock(
  "@/features/auth/auth-provider",
  () => ({ useAuth: () => ({ user: { id: "synthetic-owner" } }) }),
);
jest.mock("@/features/wallet/withdrawal-repository", () => {
  const actual = jest.requireActual("@/features/wallet/withdrawal-repository");
  return {
    ...actual,
    withdrawalRepository: {
      balance: jest.fn(),
      banks: jest.fn(),
      orders: jest.fn(),
      resolve: jest.fn(),
      quote: jest.fn(),
      submit: jest.fn(),
      refresh: jest.fn(),
    },
  };
});
jest.mock(
  "@/components/layout/app-screen",
  () => ({
    AppScreen: ({ children }: { children: React.ReactNode }) => {
      const { View } = jest.requireActual("react-native");
      return <View>{children}</View>;
    },
  }),
);
jest.mock(
  "expo-router",
  () => ({
    router: { canGoBack: () => false, replace: jest.fn(), push: jest.fn() },
  }),
);
jest.mock(
  "@/features/services/supabase-service-repository",
  () => ({ invokeAction: jest.fn() }),
);
jest.mock(
  "expo-crypto",
  () => ({ randomUUID: () => "synthetic-operation-id" }),
);
beforeEach(() => {
  jest.mocked(api.balance).mockResolvedValue({
    availableMinor: 2000000,
    walletAvailableMinor: 3000000,
    enabled: true,
    baseFeeMinor: 3000,
    levyMinor: 5000,
    levyThresholdMinor: 1000000,
  });
  jest.mocked(api.banks).mockResolvedValue([{
    code: "0001",
    name: "Synthetic Bank",
  }, { code: "0002", name: "Another Bank" }]);
  jest.mocked(api.orders).mockResolvedValue([]);
  jest.mocked(api.resolve).mockResolvedValue({
    recipientToken: "recipient-token",
    accountName: "SYNTHETIC TESTER",
    bankName: "Synthetic Bank",
    accountLastFour: "0000",
  });
  jest.mocked(api.quote).mockResolvedValue({
    quoteId: "opaque-quote",
    amountMinor: 100000,
    feeMinor: 3000,
    totalMinor: 103000,
    accountName: "SYNTHETIC TESTER",
    bankName: "Synthetic Bank",
    accountLastFour: "0000",
    expiresAt: "2099-01-01",
  });
  jest.mocked(api.submit).mockResolvedValue({
    id: "order-1",
    transaction_id: "transaction-1",
    status: "succeeded",
    amount_minor: 100000,
    fee_minor: 3000,
    bank_name: "Synthetic Bank",
    account_last_four: "0000",
    status_message: "Withdrawal completed.",
    created_at: "2026-10-25",
    completed_at: "2026-10-25",
  });
});
async function mountAndReview() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <WithdrawScreen />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Choose bank" })).not
      .toBeDisabled()
  );
  await fireEvent.press(screen.getByRole("button", { name: "Choose bank" }));
  await fireEvent.changeText(
    screen.getByLabelText("Search banks"),
    "Synthetic",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Synthetic Bank" }));
  await fireEvent.changeText(
    screen.getByLabelText("Account number"),
    "0000000000",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Verify account" }));
  await waitFor(() =>
    expect(screen.getByText("SYNTHETIC TESTER")).toBeTruthy()
  );
  await fireEvent.changeText(
    screen.getByLabelText("Amount to receive (NGN)"),
    "1,000",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(screen.getByText("Review withdrawal")).toBeTruthy()
  );
  return client;
}
test("bank review shows exact fees and requires PIN before dispatch", async () => {
  const client = await mountAndReview();
  expect(api.resolve).toHaveBeenCalledWith("0001", "0000000000");
  expect(api.quote).toHaveBeenCalledWith("recipient-token", 100000);
  expect(screen.getByText("₦30.00")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirm withdrawal" }))
    .toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Transaction PIN"), "4827");
  await fireEvent.press(
    screen.getByRole("button", { name: "Confirm withdrawal" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Withdrawal complete")).toBeTruthy()
  );
  expect(api.submit).toHaveBeenCalledWith({
    quoteId: "opaque-quote",
    pin: "4827",
    idempotencyKey: "withdraw-synthetic-operation-id",
  });
  expect(screen.getByRole("button", { name: "View receipt" })).toBeTruthy();
  client.clear();
});
test("wrong PIN keeps review editable and a retry retains the operation key", async () => {
  jest.mocked(api.submit).mockRejectedValueOnce(
    new ServiceApiError(
      "forbidden",
      "Incorrect PIN or PIN temporarily locked.",
    ),
  );
  const client = await mountAndReview();
  await fireEvent.changeText(screen.getByLabelText("Transaction PIN"), "1234");
  await fireEvent.press(
    screen.getByRole("button", { name: "Confirm withdrawal" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Incorrect PIN or PIN temporarily locked."))
      .toBeTruthy()
  );
  await fireEvent.changeText(screen.getByLabelText("Transaction PIN"), "4827");
  await fireEvent.press(
    screen.getByRole("button", { name: "Confirm withdrawal" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Withdrawal complete")).toBeTruthy()
  );
  expect(jest.mocked(api.submit).mock.calls.map((c) => c[0].idempotencyKey))
    .toEqual([
      "withdraw-synthetic-operation-id",
      "withdraw-synthetic-operation-id",
    ]);
  client.clear();
});
test("uncertain network result uses the original request instead of starting another withdrawal", async () => {
  jest.mocked(api.submit).mockRejectedValueOnce(
    new ServiceApiError("network", "Connection interrupted."),
  );
  const client = await mountAndReview();
  await fireEvent.changeText(screen.getByLabelText("Transaction PIN"), "4827");
  await fireEvent.press(
    screen.getByRole("button", { name: "Confirm withdrawal" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Check my withdrawal" }))
      .toBeTruthy()
  );
  expect(screen.queryByRole("button", { name: "Change details" })).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: "Check my withdrawal" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Withdrawal complete")).toBeTruthy()
  );
  expect(jest.mocked(api.submit).mock.calls[0][0].idempotencyKey).toBe(
    jest.mocked(api.submit).mock.calls[1][0].idempotencyKey,
  );
  client.clear();
});
test("withdrawal amount parsing is exact and never rounds fractional naira", () => {
  expect(withdrawalAmount("10,000")).toBe(1000000);
  for (const v of ["1.01", "0", "-1", "1e4", "90071992547410", ""]) {
    expect(withdrawalAmount(v)).toBeNull();
  }
});
