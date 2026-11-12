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
      basketQuote: jest.fn(),
      checkout: jest.fn(),
      checkoutStatus: jest.fn(),
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
test('US monthly plan shows calendar-month label, NGN price and cancellation terms before payment', async () => {
  jest.mocked(numberRepository.market).mockResolvedValue({services:[...services,
    {id:'us-month',name:'All services',country:'US',kind:'general',periodLabel:'1 month',prices:{'30':560000}}],countries:['US','CA','GB'],refreshedAt:'2026-11-13'});
  jest.mocked(numberRepository.quote).mockResolvedValue({quoteToken:'monthly-owner-quote',name:'All services',country:'US',kind:'general',periodLabel:'1 month',duration:30,totalMinor:560000});
  const {done}=await mount();
  await fireEvent.press(screen.getByText('1 month'));
  expect(screen.queryByText('30 days')).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'All services, 1 month, ₦5,600.00'}));
  await fireEvent.press(screen.getByRole('button',{name:'Review · ₦5,600.00'}));
  await waitFor(()=>expect(screen.getByText('Review your number')).toBeTruthy());
  expect(screen.getByText(/Eligible unused rentals can be cancelled within 20 minutes/)).toBeTruthy();
  expect(numberRepository.quote).toHaveBeenCalledWith('us-month',30,undefined);
  expect(numberRepository.buy).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button',{name:'Pay ₦5,600.00'}));
  await waitFor(()=>expect(done).toHaveBeenCalled());
  expect(numberRepository.buy).toHaveBeenCalledWith('monthly-owner-quote','sms-11111111-1111-4111-8111-111111111111');
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

test('Canada monthly plans do not inherit the short-term provider VoIP claim', async () => {
  jest.mocked(numberRepository.market).mockResolvedValue({services:[...services,
    {id:'ca-month',name:'All services',country:'CA',kind:'general',periodLabel:'1 month',prices:{'30':490000}}],countries:['US','CA','GB'],refreshedAt:'2026-11-13'});
  await mount();
  await fireEvent.press(screen.getByRole('button',{name:'More'}));
  await fireEvent.press(screen.getByText('Canada'));
  expect(screen.getByText(/Canadian numbers use VoIP/)).toBeTruthy();
  await fireEvent.press(screen.getByText('1 month'));
  expect(screen.queryByText(/Canadian numbers use VoIP/)).toBeNull();
  expect(screen.getByRole('button',{name:'All services, 1 month, ₦4,900.00'})).toBeTruthy();
});
test("visible NGN price, explicit review and PIN-free payment use stable idempotency key", async () => {
  const { done } = await mount();
  await fireEvent.press(screen.getByLabelText("Choose website or app"));
  await fireEvent.press(
    screen.getByRole("checkbox", { name: "WhatsApp, ₦2,520.00" }),
  );
  await fireEvent.press(screen.getByRole('button', {name:'Use 1 service · ₦2,520.00'}));
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
    screen.getByRole("checkbox", { name: "WhatsApp, ₦2,520.00" }),
  );
  await fireEvent.press(screen.getByRole('button', {name:'Use 1 service · ₦2,520.00'}));
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
  expect(screen.getByRole('checkbox', { name: 'WhatsApp, ₦2,520.00' })).toBeTruthy();
  expect(screen.getByTestId('sms-picker-sheet')).toHaveStyle({ height: '93%' });
  await fireEvent.changeText(screen.getByLabelText('Search services'), 'doesnotexist');
  expect(screen.getByText('No services match. Try a different name.')).toBeTruthy();
  expect(screen.getByTestId('sms-picker-sheet')).toHaveStyle({ height: '93%' });
  expect(numberRepository.market).toHaveBeenCalledTimes(1);
});

test('checkbox basket keeps selections while searching, reviews each price, and pays once without a PIN', async () => {
  const { done } = await mount();
  await fireEvent.press(screen.getByRole('button', {name:'United Kingdom'}));
  await fireEvent.press(screen.getByLabelText('Choose website or app'));
  expect(screen.queryByRole('checkbox', {name:'Select multiple services'})).toBeNull();
  await fireEvent.press(screen.getByRole('checkbox', {name:'WhatsApp, ₦2,800.00'}));
  await fireEvent.changeText(screen.getByLabelText('Search services'), 'tele');
  await fireEvent.press(screen.getByRole('checkbox', {name:'Telegram, ₦1,400.00'}));
  expect(screen.getByRole('checkbox', {name:'Telegram, ₦1,400.00'}).props.accessibilityState.checked).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Search services'), 'whats');
  expect(screen.getByRole('checkbox', {name:'WhatsApp, ₦2,800.00'}).props.accessibilityState.checked).toBe(true);
  await fireEvent.press(screen.getByRole('button', {name:'Use 2 services · ₦4,200.00'}));
  jest.mocked(numberRepository.basketQuote).mockResolvedValue({quoteToken:'basket-token',country:'GB',duration:0,totalMinor:420000,
    items:[{productId:'gb-wa',name:'WhatsApp',totalMinor:280000},{productId:'gb-tg',name:'Telegram',totalMinor:140000}]});
  jest.mocked(numberRepository.checkout).mockResolvedValue({checkoutId:'basket',totalMinor:420000,orders:[{id:'one'},{id:'two'}] as NumberOrder[]});
  await fireEvent.press(screen.getByRole('button', {name:'Review · ₦4,200.00'}));
  await waitFor(() => expect(screen.getByText('Review your numbers')).toBeTruthy());
  expect(numberRepository.basketQuote).toHaveBeenCalledWith(['gb-wa','gb-tg']);
  expect(screen.getByText('₦2,800.00')).toBeTruthy();
  expect(screen.getByText('₦1,400.00')).toBeTruthy();
  expect(screen.queryByText('Transaction PIN')).toBeNull();
  await fireEvent.press(screen.getByRole('button', {name:'Pay ₦4,200.00'}));
  await waitFor(() => expect(done).toHaveBeenCalledWith('2 number requests saved. Track each one below.'));
  expect(numberRepository.checkout).toHaveBeenCalledTimes(1);
  expect(numberRepository.buy).not.toHaveBeenCalled();
});

test('lost basket acknowledgement is recovered by its original key, without a replacement purchase', async () => {
  const { done } = await mount();
  await fireEvent.press(screen.getByRole('button', {name:'United Kingdom'}));
  await fireEvent.press(screen.getByLabelText('Choose website or app'));
  await fireEvent.press(screen.getByRole('checkbox', {name:'WhatsApp, ₦2,800.00'}));
  await fireEvent.press(screen.getByRole('checkbox', {name:'Telegram, ₦1,400.00'}));
  await fireEvent.press(screen.getByRole('button', {name:'Use 2 services · ₦4,200.00'}));
  jest.mocked(numberRepository.basketQuote).mockResolvedValue({quoteToken:'basket-token',country:'GB',duration:0,totalMinor:420000,
    items:[{productId:'gb-wa',name:'WhatsApp',totalMinor:280000},{productId:'gb-tg',name:'Telegram',totalMinor:140000}]});
  jest.mocked(numberRepository.checkout).mockRejectedValueOnce(new Error('Connection lost'));
  jest.mocked(numberRepository.checkoutStatus).mockResolvedValue({checkoutId:'original',totalMinor:420000,orders:[{id:'original-order'},{id:'other-order'}] as NumberOrder[]});
  await fireEvent.press(screen.getByRole('button', {name:'Review · ₦4,200.00'}));
  await waitFor(() => expect(screen.getByText('Review your numbers')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', {name:'Pay ₦4,200.00'}));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(numberRepository.checkoutStatus).toHaveBeenCalledWith('sms-11111111-1111-4111-8111-111111111111');
  expect(numberRepository.checkout).toHaveBeenCalledTimes(1);
});

test('changing duration clears a short-term basket and long rentals stay single-service', async () => {
  await mount();
  await fireEvent.press(screen.getByRole('button',{name:'United Kingdom'}));
  await fireEvent.press(screen.getByLabelText('Choose website or app'));
  await fireEvent.press(screen.getByRole('checkbox',{name:'WhatsApp, ₦2,800.00'}));
  await fireEvent.press(screen.getByRole('button',{name:'Use 1 service · ₦2,800.00'}));
  await fireEvent.press(screen.getByText('7 days'));
  expect(screen.getByRole('button',{name:'Choose a website to start'})).toBeDisabled();
  await fireEvent.press(screen.getByLabelText('Choose website or app'));
  expect(screen.queryByRole('checkbox',{name:'Select multiple services'})).toBeNull();
  expect(screen.getByRole('button',{name:'WhatsApp, ₦7,000.00'})).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'WhatsApp, ₦7,000.00'}));
  await fireEvent.press(screen.getByText('20 minutes'));
  await fireEvent.press(screen.getByLabelText('Choose website or app'));
  expect(screen.getByRole('checkbox',{name:'WhatsApp, ₦2,800.00'}).props.accessibilityState.checked).toBe(false);
  expect(screen.getByRole('button',{name:'Choose your services'})).toBeDisabled();
});

test('checkboxes work immediately, persist on reopening, and allow clearing all selections', async () => {
  await mount();
  await fireEvent.press(screen.getByRole('button',{name:'United Kingdom'}));
  await fireEvent.press(screen.getByLabelText('Choose website or app'));
  expect(screen.queryByText('Select multiple')).toBeNull();
  expect(screen.getByRole('checkbox',{name:'WhatsApp, ₦2,800.00'}).props.accessibilityState.checked).toBe(false);
  await fireEvent.press(screen.getByRole('checkbox',{name:'WhatsApp, ₦2,800.00'}));
  await fireEvent.press(screen.getByRole('checkbox',{name:'Telegram, ₦1,400.00'}));
  await fireEvent.press(screen.getByRole('button',{name:'Use 2 services · ₦4,200.00'}));
  await fireEvent.press(screen.getByLabelText('Choose website or app'));
  expect(screen.getByRole('checkbox',{name:'WhatsApp, ₦2,800.00'}).props.accessibilityState.checked).toBe(true);
  await fireEvent.press(screen.getByRole('checkbox',{name:'WhatsApp, ₦2,800.00'}));
  expect(screen.getByRole('button',{name:'Use 1 service · ₦1,400.00'})).toBeEnabled();
  await fireEvent.press(screen.getByRole('checkbox',{name:'Telegram, ₦1,400.00'}));
  expect(screen.getByRole('button',{name:'Choose your services'})).toBeDisabled();
  await fireEvent.press(screen.getByRole('button',{name:'Close'}));
  expect(screen.getByRole('button',{name:'Choose a website to start'})).toBeDisabled();
  expect(numberRepository.market).toHaveBeenCalledTimes(1);
  expect(numberRepository.quote).not.toHaveBeenCalled();
  expect(numberRepository.basketQuote).not.toHaveBeenCalled();
});

test('one checked US service retains its optional location and single-number quote', async () => {
  await mount();
  jest.mocked(numberRepository.locations).mockResolvedValue({locations:[{code:'CA',name:'California'}]});
  await fireEvent.press(screen.getByLabelText('Choose website or app'));
  await fireEvent.press(screen.getByRole('checkbox',{name:'WhatsApp, ₦2,520.00'}));
  await fireEvent.press(screen.getByRole('button',{name:'Use 1 service · ₦2,520.00'}));
  await fireEvent.press(screen.getByText('Any available location'));
  await waitFor(() => expect(screen.getByText('California')).toBeTruthy());
  await fireEvent.press(screen.getByText('California'));
  await fireEvent.press(screen.getByRole('button',{name:'Review · ₦2,520.00'}));
  await waitFor(() => expect(screen.getByText('Review your number')).toBeTruthy());
  expect(numberRepository.quote).toHaveBeenCalledWith('us-wa',0,'CA');
  expect(numberRepository.basketQuote).not.toHaveBeenCalled();
});

test('US 28-day all-services shows its NGN price without a website or location picker', async () => {
  jest.mocked(numberRepository.market).mockResolvedValue({services:[...services,
    {id:'all-us',name:'All services',country:'US',kind:'general',prices:{'28':1818600}}],countries:['US','GB','CA'],refreshedAt:'2026-11-12'});
  await mount();
  await fireEvent.press(screen.getByRole('button',{name:'28 days'}));
  expect(screen.queryByLabelText('Choose website or app')).toBeNull();
  expect(screen.queryByText('Location')).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'All services, 28 days, ₦18,186.00'}));
  jest.mocked(numberRepository.quote).mockResolvedValue({quoteToken:'all-token',name:'All services',country:'US',duration:28,totalMinor:1818600,kind:'general'});
  await fireEvent.press(screen.getByRole('button',{name:'Review · ₦18,186.00'}));
  await waitFor(()=>expect(screen.getByText('Review your number')).toBeTruthy());
  expect(numberRepository.quote).toHaveBeenCalledWith('all-us',28,undefined);
  expect(screen.getByText(/Long rentals are not automatically refundable/)).toBeTruthy();
  expect(numberRepository.buy).not.toHaveBeenCalled();
});

test('Hong Kong defaults to its available duration and switching country clears an all-services selection', async () => {
  jest.mocked(numberRepository.market).mockResolvedValue({services:[...services,
    {id:'all-hk',name:'All services',country:'HK',kind:'general',prices:{'30':1610000,'180':3150000}}],countries:['US','GB','HK'],refreshedAt:'2026-11-12'});
  await mount();
  await fireEvent.press(screen.getByRole('button',{name:'More'}));
  await fireEvent.press(screen.getByText('Hong Kong'));
  expect(screen.getByRole('button',{name:'30 days'}).props.accessibilityState.selected).toBe(true);
  await fireEvent.press(screen.getByRole('button',{name:'All services, 30 days, ₦16,100.00'}));
  expect(screen.getByRole('button',{name:'Review · ₦16,100.00'})).toBeEnabled();
  await fireEvent.press(screen.getByRole('button',{name:'United States'}));
  expect(screen.getByRole('button',{name:'Choose a website to start'})).toBeDisabled();
  expect(numberRepository.market).toHaveBeenCalledTimes(1);
});
