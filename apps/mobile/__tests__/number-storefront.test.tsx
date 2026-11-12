import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { POPULAR_SMS_SERVICES } from '@/features/numbers/popular-services';
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

test('exactly 50 curated services precede the alphabetical remainder without inventing stock', () => {
  expect(POPULAR_SMS_SERVICES).toHaveLength(50);
  expect(new Set(POPULAR_SMS_SERVICES).size).toBe(50);
  const names = ['Zebra', ...POPULAR_SMS_SERVICES.slice().reverse(), 'Aardvark', 'SignalWire', 'Apple Cinemas'];
  const catalog = names.map((name) => ({ id: name, name, country: 'US', prices: { '0': 100 } }));
  const before = [...catalog];
  const sorted = smsProducts(catalog, 'US', 0, '');
  expect(sorted.slice(0, 50).map((s) => s.name)).toEqual([...POPULAR_SMS_SERVICES]);
  expect(sorted.slice(50).map((s) => s.name)).toEqual(['Aardvark', 'Apple Cinemas', 'SignalWire', 'Zebra']);
  expect(catalog).toEqual(before);
  expect(smsProducts(catalog, 'US', 0, 'whats').map((s) => s.name)).toEqual(['WhatsApp']);
  expect(smsProducts(catalog, 'CA', 0, '')).toEqual([]);
});

test('service search keeps a fixed sheet and a flexible results area with one or zero matches', async () => {
  await mount();
  await fireEvent.press(screen.getByLabelText('Choose website or app'));
  expect(screen.getByTestId('sms-picker-sheet')).toHaveStyle({ height: '93%', minHeight: 0 });
  expect(screen.getByTestId('sms-service-results')).toHaveStyle({ flex: 1, minHeight: 0 });
  expect(screen.getByText('Popular services')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Search services'), 'whats');
  expect(screen.getByRole('button', { name: 'WhatsApp, ₦2,520.00' })).toBeTruthy();
  expect(screen.getByTestId('sms-picker-sheet')).toHaveStyle({ height: '93%' });
  await fireEvent.changeText(screen.getByLabelText('Search services'), 'doesnotexist');
  expect(screen.getByText('No services match. Try a different name.')).toBeTruthy();
  expect(screen.getByTestId('sms-picker-sheet')).toHaveStyle({ height: '93%' });
  expect(numberRepository.market).toHaveBeenCalledTimes(1);
});
