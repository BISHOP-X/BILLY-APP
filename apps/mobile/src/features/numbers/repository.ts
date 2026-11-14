import { invokeAction } from '@/features/services/supabase-service-repository';

export type NumberService = {
  kind?: 'short' | 'general' | 'service';
  periodLabel?: string;
  available?: boolean;
  actionLabel?: string;
  name: string;
  totalMinor: number;
  quoteToken: string;
  countryCode: 'US';
  expiresAt: string;
};
export type NumberCatalog = {
  services: NumberService[];
  page: number;
  pages: number;
  total: number;
};
export type NumberOrder = {
  continuous_messages?: boolean;
  can_cancel?: boolean | null;
  refund_minor?: number;
  rental_kind?: 'short' | 'general' | 'service';
  rental_period?: string | null;
  rental_end?: string | null;
  rental_closed?: boolean;
  awaiting_another?: boolean;
  supports_extras?: boolean;
  operation?: string;
  id: string;
  transaction_id: string;
  service_name: string;
  country_code: string;
  phone_number: string | null;
  sms_code: string | null;
  amount_minor: number;
  fee_minor: number;
  status:
    | 'processing'
    | 'waiting'
    | 'received'
    | 'cancelled'
    | 'failed'
    | 'manual_review';
  status_message: string;
  cancel_requested: boolean;
  expires_at: string | null;
  created_at: string;
  completed_at: string | null;
};
export const numberRepository = {
  reusePreview: (orderId: string) => invokeAction<{quoteToken:string;totalMinor:number}>('numbers.reuse.preview',{orderId}),
  reuseConfirm: (orderId:string,quoteToken:string,idempotencyKey:string) => invokeAction<ReuseState>('numbers.reuse.confirm',{orderId,quoteToken,idempotencyKey}),
  reuseStatus: (orderId:string,idempotencyKey?:string) => invokeAction<ReuseState|null>('numbers.reuse.status',{orderId,idempotencyKey}),
  forTransactions: (transactionIds: string[]) => invokeAction<{ orders: NumberOrder[] }>('numbers.for-transactions', { transactionIds }),
  carrier: (orderId: string) => invokeAction<{ carrier: string | null }>('numbers.carrier', { orderId }),
  store: () => invokeAction<{ layout: 'legacy' | 'international'; available: boolean }>('numbers.store', {}),
  market: () => invokeAction<SmsMarket>('numbers.market', {}),
  locations: (productId: string, duration: number) => invokeAction<{ locations: { code: string; name: string }[] }>('numbers.locations', { productId, duration }),
  quote: (productId: string, duration: number, state?: string) => invokeAction<SmsQuote>('numbers.quote', { productId, duration, state }),
  buy: (quoteToken: string, idempotencyKey: string) => invokeAction<NumberOrder>('numbers.buy', { quoteToken, idempotencyKey }),
  basketQuote: (productIds: string[]) => invokeAction<SmsBasketQuote>('numbers.basket.quote', { productIds }),
  checkout: (quoteToken: string, idempotencyKey: string) => invokeAction<SmsCheckout>('numbers.checkout', { quoteToken, idempotencyKey }),
  checkoutStatus: (idempotencyKey: string) => invokeAction<SmsCheckout | null>('numbers.checkout.status', { idempotencyKey }),
  sharedCatalog: (page: number, query: string) => invokeAction<NumberCatalog>('numbers.catalog', { page, query: query.trim() || undefined, shared: true }),
  longCatalog: (page: number, query: string) => invokeAction<NumberCatalog>('numbers.long.catalog', { page, query }),
  reuseCatalog: (orderId: string, page: number, query: string) => invokeAction<NumberCatalog>('numbers.reuse.catalog', { orderId, page, query }),
  bundleQuote: (quoteTokens: string[]) => invokeAction<NumberService>('numbers.bundle.quote', { quoteTokens }),
  rentalOptions: (orderId: string) => invokeAction<{ options: NumberService[] }>('numbers.rental.options', { orderId }),
  purchase: (input: { quoteToken: string; idempotencyKey: string }) => invokeAction<{ orders: NumberOrder[] }>('numbers.purchase', input),
  messages: (orderId: string, page = 1) => invokeAction<{ messages: NumberMessage[] }>('numbers.messages', { orderId, page }),
  another: (orderId: string) => invokeAction<NumberOrder>('numbers.another', { orderId }),
  finish: (orderId: string) => invokeAction<NumberOrder>('numbers.finish', { orderId }),
  catalog: (page: number, query: string) =>
    invokeAction<NumberCatalog>('numbers.catalog', {
      page,
      query: query.trim() || undefined,
    }),
  orders: (page: number) =>
    invokeAction<{ orders: NumberOrder[] }>('numbers.orders', { page }),
  order: (input: { quoteToken: string; idempotencyKey: string }) =>
    invokeAction<NumberOrder>('numbers.order', input),
  refresh: (orderId: string) =>
    invokeAction<NumberOrder>('numbers.refresh', { orderId }),
  cancel: (orderId: string) =>
    invokeAction<NumberOrder>('numbers.cancel', { orderId }),
};
export type ReuseState = {state:'pending'|'confirmed'|'rejected'|'review';totalMinor:number};
export type SmsProduct = { id: string; name: string; country: string; prices: Record<string, number>; kind?: 'general'; periodLabel?: string };
export type SmsMarket = { services: SmsProduct[]; countries: string[]; refreshedAt: string };
export type SmsQuote = { quoteToken: string; name: string; country: string; duration: number; totalMinor: number; kind?: 'general'; periodLabel?: string };
export type SmsBasketQuote = Omit<SmsQuote, 'name'> & { items: { productId: string; name: string; totalMinor: number }[] };
export type SmsCheckout = { checkoutId: string; totalMinor: number; orders: NumberOrder[] };
export type NumberMessage = { id: string; body: string; sender: string; received_at: string | null; created_at: string };
