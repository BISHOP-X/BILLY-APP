import type { QueryClient } from '@tanstack/react-query';
import type { NumberOrder } from './repository';

// Apply the server acknowledgement before a background list fetch. A confirmed
// cancellation must immediately stop every mounted countdown for this order.
export async function cacheNumberOrder(client: QueryClient, owner: string | undefined, order: NumberOrder) {
  const key = ['numbers', owner];
  await client.cancelQueries({ queryKey: key, predicate: query => ['orders', 'transactions'].includes(String(query.queryKey[2])) });
  client.setQueriesData({ queryKey: key, predicate: query => ['orders', 'transactions'].includes(String(query.queryKey[2])) }, (value: unknown) => {
    const replace = (rows: NumberOrder[]) => rows.map(row => row.id === order.id ? order : row);
    if (Array.isArray(value)) return replace(value);
    if (value && typeof value === 'object' && 'orders' in value && Array.isArray(value.orders)) {
      return { ...value, orders: replace(value.orders) };
    }
    return value;
  });
}
