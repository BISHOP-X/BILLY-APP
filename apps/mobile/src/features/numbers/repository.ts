import { invokeAction } from '@/features/services/supabase-service-repository';

export type NumberService = {
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
  catalog: (page: number, query: string) =>
    invokeAction<NumberCatalog>('numbers.catalog', {
      page,
      query: query.trim() || undefined,
    }),
  orders: (page: number) =>
    invokeAction<{ orders: NumberOrder[] }>('numbers.orders', { page }),
  order: (input: { quoteToken: string; pin: string; idempotencyKey: string }) =>
    invokeAction<NumberOrder>('numbers.order', input),
  refresh: (orderId: string) =>
    invokeAction<NumberOrder>('numbers.refresh', { orderId }),
  cancel: (orderId: string) =>
    invokeAction<NumberOrder>('numbers.cancel', { orderId }),
};
