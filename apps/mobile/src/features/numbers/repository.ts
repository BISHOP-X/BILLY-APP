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
  sharedCatalog: (page: number, query: string) => invokeAction<NumberCatalog>('numbers.catalog', { page, query, shared: true }),
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
export type NumberMessage = { id: string; body: string; sender: string; received_at: string | null; created_at: string };
