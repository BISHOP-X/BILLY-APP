import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OperationsError,
  requestObject,
  requestText,
} from './number-service.ts';

export type AdminRuntime = {
  client: SupabaseClient;
  readyServices: () => Promise<Record<string, boolean>>;
  refreshOrder?: (
    service: 'social' | 'numbers',
    userId: string,
    orderId: string,
  ) => Promise<unknown>;
};
export async function handleAdminAction(
  action: string,
  value: unknown,
  user: { id: string },
  runtime?: AdminRuntime,
): Promise<{ data: unknown; status?: number }> {
  if (!runtime)
    throw new OperationsError(503, 'unavailable', 'Operations is unavailable.');
  const { data: allowed, error: accessError } = await runtime.client.rpc(
    'internal_admin_access',
    { p_user_id: user.id },
  );
  // Capability discovery reveals only the caller's own membership, never a list.
  if (action === 'admin.session' && !accessError)
    return { data: { admin: allowed === true } };
  if (accessError || allowed !== true)
    throw new OperationsError(
      403,
      'forbidden',
      'This account does not have administrator access.',
    );
  const input = requestObject(value);
  if (action === 'admin.read') {
    const section = requestText(input.section, 'Section', 30);
    const { data, error } = await runtime.client.rpc('internal_admin_read', {
      p_user_id: user.id,
      p_section: section,
      p_input: input,
    });
    if (error)
      throw new OperationsError(
        503,
        'unavailable',
        'This operations view could not be loaded.',
      );
    return {
      data:
        section === 'settings'
          ? { ...data, readyServices: await runtime.readyServices() }
          : data,
    };
  }
  if (action === 'admin.change') {
    const change = requestText(input.change, 'Change', 30);
    if (change === 'service' && input.rolloutMode !== 'off') {
      const service = requestText(input.serviceKey, 'Service', 50);
      if (!(await runtime.readyServices())[service])
        throw new OperationsError(
          409,
          'conflict',
          'This service needs its provider configuration before it can be enabled.',
        );
    }
    const { data, error } = await runtime.client.rpc('internal_admin_change', {
      p_user_id: user.id,
      p_action: change,
      p_input: input,
    });
    if (error)
      throw new OperationsError(
        error.code === '40001' ? 409 : 400,
        'conflict',
        error.code === '40001'
          ? 'These settings changed. Reload before saving.'
          : 'This change could not be saved. Check the values and include a reason.',
      );
    return { data };
  }
  if (action === 'admin.refresh') {
    const service = input.service;
    if (
      (service !== 'social' && service !== 'numbers') ||
      !runtime.refreshOrder
    )
      throw new OperationsError(
        400,
        'invalid_request',
        'Invalid order service.',
      );
    const orderId = requestText(input.orderId, 'Order', 36);
    const table =
      service === 'social' ? 'social_boost_orders' : 'number_orders';
    const { data: order, error } = await runtime.client
      .from(table)
      .select('id,user_id')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !order)
      throw new OperationsError(404, 'not_found', 'Order not found.');
    // Reconciliation only: no manual success/refund override and no reallocation.
    await runtime.refreshOrder(service, order.user_id, order.id);
    return { data: { refreshed: true } };
  }
  throw new OperationsError(
    400,
    'invalid_request',
    'Unknown operations action.',
  );
}
