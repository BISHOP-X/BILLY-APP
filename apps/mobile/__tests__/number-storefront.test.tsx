import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  NumberStorefront,
  smsProducts,
} from "@/features/numbers/number-storefront";
import {
  type NumberOrder,
  numberRepository,
  type SmsProduct,
} from "@/features/numbers/repository";

jest.mock(
  "@/features/auth/auth-provider",
  () => ({ useAuth: () => ({ user: { id: "synthetic-owner" } }) }),
);
jest.mock(
  "react-native-safe-area-context",
  () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  }),
);
jest.mock(
  "expo-crypto",
  () => ({ randomUUID: () => "11111111-1111-4111-8111-111111111111" }),
);
jest.mock(
  "@/features/numbers/repository",
  () => ({
    numberRepository: {
      market: jest.fn(),
      quote: jest.fn(),
      locations: jest.fn(),
      buy: jest.fn(),
    },
  }),
);
const services: SmsProduct[] = [
  { id: "us-wa", name: "WhatsApp", country: "US", prices: { "0": 252000 } },
  {
    id: "gb-wa",
    name: "WhatsApp",
    country: "GB",
    prices: { "0": 280000, "7": 700000 },
  },
  { id: "gb-tg", name: "Telegram", country: "GB", prices: { "0": 140000 } },
  { id: "ca-wa", name: "WhatsApp", country: "CA", prices: { "0": 112000 } },
];
async function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const done = jest.fn();
  await render(
    <QueryClientProvider client={client}>
      <NumberStorefront onDone={done} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("20 minutes")).toBeTruthy());
  return { client, done };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(numberRepository.market).mockResolvedValue({
    services,
    countries: ["US", "GB", "CA"],
    refreshedAt: "2026-11-12",
  });
  jest.mocked(numberRepository.locations).mockResolvedValue({ locations: [] });
  jest.mocked(numberRepository.quote).mockResolvedValue({
    quoteToken: "owner-bound-quote",
    name: "WhatsApp",
    country: "US",
    duration: 0,
    totalMinor: 252000,
  });
  jest.mocked(numberRepository.buy).mockResolvedValue(
    {
      id: "synthetic-order",
      status_message: "Your number is ready.",
    } as NumberOrder,
  );
});
test("country, duration and typing filter instantly without reloading catalogue", async () => {
  await mount();
  await fireEvent.press(screen.getByRole("button", { name: "United Kingdom" }));
  await fireEvent.press(screen.getByText("7 days"));
  await fireEvent.press(screen.getByLabelText("Choose website or app"));
  expect(screen.getByRole("button", { name: "WhatsApp, ₦7,000.00" }))
    .toBeTruthy();
  expect(screen.queryByText("Telegram")).toBeNull();
  await fireEvent.changeText(
    screen.getByPlaceholderText("WhatsApp, Google, Telegram…"),
    "nomatch",
  );
  expect(screen.getByText("No services match. Try a different name."))
    .toBeTruthy();
  await fireEvent.changeText(
    screen.getByPlaceholderText("WhatsApp, Google, Telegram…"),
    "whats",
  );
  expect(screen.getByRole("button", { name: "WhatsApp, ₦7,000.00" }))
    .toBeTruthy();
  expect(numberRepository.market).toHaveBeenCalledTimes(1);
  expect(numberRepository.quote).not.toHaveBeenCalled();
});
test("visible NGN price, explicit review and PIN-free payment use stable idempotency key", async () => {
  const { done } = await mount();
  await fireEvent.press(screen.getByLabelText("Choose website or app"));
  await fireEvent.press(
    screen.getByRole("button", { name: "WhatsApp, ₦2,520.00" }),
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Review · ₦2,520.00" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Review your number")).toBeTruthy()
  );
  expect(numberRepository.quote).toHaveBeenCalledWith("us-wa", 0, undefined);
  expect(numberRepository.buy).not.toHaveBeenCalled();
  expect(screen.queryByText("Transaction PIN")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Pay ₦2,520.00" }));
  await waitFor(() =>
    expect(done).toHaveBeenCalledWith("Your number is ready.")
  );
  expect(numberRepository.buy).toHaveBeenCalledTimes(1);
  expect(numberRepository.buy).toHaveBeenCalledWith(
    "owner-bound-quote",
    "sms-11111111-1111-4111-8111-111111111111",
  );
});
test("failed payment keeps review and retry uses the same key", async () => {
  await mount();
  jest.mocked(numberRepository.buy).mockRejectedValueOnce(
    new Error("Check My numbers before trying again."),
  );
  await fireEvent.press(screen.getByLabelText("Choose website or app"));
  await fireEvent.press(
    screen.getByRole("button", { name: "WhatsApp, ₦2,520.00" }),
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Review · ₦2,520.00" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Review your number")).toBeTruthy()
  );
  await fireEvent.press(screen.getByRole("button", { name: "Pay ₦2,520.00" }));
  await waitFor(() =>
    expect(screen.getByText("Check My numbers before trying again."))
      .toBeTruthy()
  );
  await fireEvent.press(screen.getByRole("button", { name: "Pay ₦2,520.00" }));
  await waitFor(() => expect(numberRepository.buy).toHaveBeenCalledTimes(2));
  expect(jest.mocked(numberRepository.buy).mock.calls[0]).toEqual(
    jest.mocked(numberRepository.buy).mock.calls[1],
  );
});
test("filter keeps country-specific service IDs distinct and ignores zero-price offers", () => {
  expect(smsProducts(services, "GB", 7, " WhatsApp ").map((s) => s.id)).toEqual(
    ["gb-wa"],
  );
  expect(smsProducts(services, "CA", 0, "").map((s) => s.id)).toEqual([
    "ca-wa",
  ]);
  expect(smsProducts(services, "US", 7, "")).toEqual([]);
});
