import { NumberProviderError, type NumberStatus } from '../providers/getatext.ts';
import { type NumberOrder, type NumberProviderKey, type NumberRuntime, OperationsError } from './number-service.ts';

/** Retry only idempotent database work. Never put a provider purchase in here. */
export async function retryNumberWrite<T>(write: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await write(); } catch (error) { last = error; }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  throw last;
}

export function failedAllocation(error: unknown): Record<string, unknown> {
  const known = error instanceof NumberProviderError ? error : undefined;
  return {
    state: known && !known.uncertain ? 'rejected' : 'unknown',
    code: known?.evidence?.code ?? 'UNCLASSIFIED_ERROR',
    ...(known?.evidence?.httpStatus ? { httpStatus: known.evidence.httpStatus } : {}),
    ...(known?.evidence?.rentalId ? { rentalId: known.evidence.rentalId } : {}),
  };
}

export async function recordNumberReceipt(runtime: NumberRuntime, userId: string, orderId: string,
  providerKey: NumberProviderKey, kind: 'allocation' | 'status' | 'recovery',
  outcome: Record<string, unknown>, response?: string, claimToken?: string) {
  const input = { ...outcome, digest: await runtime.digest(JSON.stringify(outcome)) };
  // Raw/partial provider replies never enter customer rows or plaintext logs.
  const ciphertext = runtime.receiptCipher
    ? await runtime.receiptCipher.encrypt({ outcome: input, response }) : null;
  try {
    return await retryNumberWrite(() => runtime.database.rpc<number>('internal_number_record_receipt', {
      p_user_id: userId, p_order_id: orderId, p_provider_key: providerKey,
      p_kind: kind, p_input: input, p_ciphertext: ciphertext, p_claim_token: claimToken ?? null,
    }));
  } catch {
    console.error('number_receipt_persistence_failed', {
      order_id: orderId, provider: providerKey, kind, digest: input.digest,
      // Encrypted emergency evidence survives a DB outage; no secrets/phone/code.
      receipt_ciphertext: ciphertext,
    });
    throw new OperationsError(503, 'unavailable', 'Your request is being checked. Open your orders before trying again.', true);
  }
}

export function applyNumberReceipt(runtime: NumberRuntime, userId: string, orderId: string, receiptId: number) {
  return retryNumberWrite(() => runtime.database.rpc<NumberOrder>('internal_number_apply_receipt', {
    p_user_id: userId, p_order_id: orderId, p_receipt_id: receiptId,
  }));
}

export async function recoverNumber(runtime: NumberRuntime, userId: string, orderId: string): Promise<NumberOrder | undefined> {
  const context = await runtime.database.rpc<{
    handled: boolean; order: NumberOrder; receiptId?: number; recoveryId?: string;
    providerKey?: NumberProviderKey; claimToken?: string;
  }>('internal_number_recovery_context', { p_user_id: userId, p_order_id: orderId });
  if (!context?.handled) return undefined;
  if (context.receiptId) return applyNumberReceipt(runtime, userId, orderId, context.receiptId);
  if (!context.recoveryId || !context.providerKey || !context.claimToken) return context.order;
  const adapter = context.providerKey === 'getatext' ? runtime.adapter : runtime.additionalAdapters?.[context.providerKey];
  if (!adapter) return context.order;
  let result: NumberStatus;
  try {
    result = await adapter.status(context.recoveryId);
    // Only incomplete/undelivered allocations reach here. Never re-rent them.
    if (result.state === 'waiting') result = await adapter.cancel(context.recoveryId);
  } catch { return context.order; }
  if (!['received', 'cancelled'].includes(result.state)) return context.order;
  const receipt = await recordNumberReceipt(runtime, userId, orderId, context.providerKey, 'recovery',
    { ...result, rentalId: context.recoveryId }, undefined, context.claimToken);
  return applyNumberReceipt(runtime, userId, orderId, receipt);
}
