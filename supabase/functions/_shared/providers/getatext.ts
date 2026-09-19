// Contract: https://getatext.com/api-docs, checked 2026-09-19.
// Only the server owns these credentials. Never log URLs, SMS codes or bodies.
export type NumberService = {
  serviceId: string;
  name: string;
  priceMicroUsd: number;
  stock: number;
  multipleSms: boolean;
  ttlMinutes?: number;
};
export type NumberAllocation = {
  rentalId: string;
  phoneNumber: string;
  priceMicroUsd?: number;
  expiresAt?: string;
};
export type NumberStatus =
  | { state: 'received'; code: string }
  | { state: 'waiting' | 'cancelled' | 'unknown' | 'locked' };
export interface NumberAdapter {
  readonly tier?: 'premium' | 'standard';
  services(): Promise<NumberService[]>;
  rent(serviceId: string, maximumMicroUsd: number): Promise<NumberAllocation>;
  status(rentalId: string): Promise<NumberStatus>;
  cancel(rentalId: string): Promise<NumberStatus>;
}

export class NumberProviderError extends Error {
  constructor(
    readonly uncertain: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'NumberProviderError';
  }
}

export function usdMicros(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(value).trim());
  if (!match) return;
  const result =
    BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : undefined;
}

export function usdDecimal(micros: number): string {
  if (!Number.isSafeInteger(micros) || micros < 0)
    throw new Error('Invalid USD amount.');
  const value = BigInt(micros);
  return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, '0')}`;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizeNumberServices(value: unknown): NumberService[] {
  const envelope = object(value);
  const rows = Array.isArray(value) ? value : envelope?.prices;
  if (!Array.isArray(rows))
    throw new NumberProviderError(
      false,
      'Number services are temporarily unavailable.',
    );
  const services = new Map<string, NumberService>();
  for (const raw of rows.slice(0, 10_000)) {
    const row = object(raw);
    if (!row) continue;
    const serviceId =
      typeof row.api_name === 'string' ? row.api_name.trim() : '';
    const name =
      typeof row.service_name === 'string'
        ? row.service_name.trim().slice(0, 160)
        : '';
    const price = usdMicros(row.price);
    const stock = Number(row.stock);
    const ttl = Number(row.ttl);
    if (
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(serviceId) ||
      !name ||
      !price ||
      !Number.isSafeInteger(stock) ||
      stock < 0 ||
      services.has(serviceId)
    )
      continue;
    services.set(serviceId, {
      serviceId,
      name,
      priceMicroUsd: price,
      stock,
      multipleSms: row.multiple_sms === true || row.multiple_sms === 'true',
      ...(Number.isSafeInteger(ttl) && ttl > 0 && ttl <= 10_080
        ? { ttlMinutes: ttl }
        : {}),
    });
  }
  return [...services.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeNumberStatus(value: string): NumberStatus {
  const raw = value.trim();
  if (raw.startsWith('STATUS_OK:') || raw.startsWith('STATUS_WAIT_RETRY:')) {
    const code = raw.slice(raw.indexOf(':') + 1).trim();
    if (code && code.length <= 512 && !/[\x00-\x1f]/.test(code))
      return { state: 'received', code };
    return { state: 'unknown' };
  }
  if (raw === 'STATUS_WAIT_CODE') return { state: 'waiting' };
  if (raw === 'STATUS_CANCEL' || raw === 'ACCESS_CANCEL')
    return { state: 'cancelled' };
  if (raw === 'EARLY_CANCEL_DENIED' || raw === 'RENTAL_LOCKED')
    return { state: 'locked' };
  // NO_ACTIVATION does not prove a refund; neither do undocumented responses.
  return { state: 'unknown' };
}

export class GetatextAdapter implements NumberAdapter {
  readonly tier: 'premium' | 'standard';
  readonly #key: string;
  readonly #fetch: typeof fetch;
  #cache?: { expires: number; services: NumberService[] };
  #inflight?: Promise<NumberService[]>;
  constructor(
    apiKey: string,
    request: typeof fetch = fetch,
    tier: 'premium' | 'standard' = 'premium',
  ) {
    if (!apiKey.trim()) throw new Error('GETATEXT_API_KEY is required.');
    this.#key = apiKey.trim();
    this.#fetch = request;
    this.tier = tier;
  }

  async services() {
    if (this.#cache && this.#cache.expires > Date.now())
      return this.#cache.services;
    if (!this.#inflight) {
      this.#inflight = (async () => {
        try {
          const response = await this.#fetch(
            'https://getatext.com/api/v1/prices-info',
            {
              headers: { Auth: this.#key, Accept: 'application/json' },
              signal: AbortSignal.timeout(8_000),
              redirect: 'error',
            },
          );
          if (!response.ok) throw new Error();
          const services = normalizeNumberServices(await response.json());
          this.#cache = { expires: Date.now() + 30_000, services };
          return services;
        } catch {
          throw new NumberProviderError(
            false,
            'Number services are temporarily unavailable. Try again shortly.',
          );
        } finally {
          this.#inflight = undefined;
        }
      })();
    }
    return this.#inflight;
  }

  async rent(
    serviceId: string,
    maximumMicroUsd: number,
  ): Promise<NumberAllocation> {
    let response: Response;
    let payload: unknown;
    try {
      response = await this.#fetch(
        `https://getatext.com/api/v1/rent-a-number${this.tier === 'premium' ? '-premium' : ''}`,
        {
          method: 'POST',
          redirect: 'error',
          headers: { Auth: this.#key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service: serviceId,
            max_price: Number(usdDecimal(maximumMicroUsd)),
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      payload = await response.json();
    } catch {
      throw new NumberProviderError(
        true,
        'We are confirming your number request. Check your orders before trying again.',
      );
    }
    const row = object(payload);
    // A documented rejection proves no allocation. Transport/server errors do not.
    if (
      [400, 403, 404, 422].includes(response.status) &&
      typeof row?.errors === 'string'
    ) {
      throw new NumberProviderError(
        false,
        'This number could not be allocated. No money was taken. Choose another service or try later.',
      );
    }
    const id = String(row?.id ?? '');
    const rawNumber = String(row?.number ?? '').replace(/^\+/, '');
    const number = rawNumber.length === 10 ? `1${rawNumber}` : rawNumber;
    const price = usdMicros(row?.price);
    if (
      !response.ok ||
      row?.status !== 'success' ||
      !/^\d{1,30}$/.test(id) ||
      !/^1\d{10}$/.test(number)
    ) {
      throw new NumberProviderError(
        true,
        'We are confirming your number request. Check your orders before trying again.',
      );
    }
    // Unzoned provider dates cannot safely be interpreted as UTC.
    const end = typeof row?.end_time === 'string' ? row.end_time : '';
    const expiresAt =
      /(?:Z|[+-]\d{2}:\d{2})$/.test(end) && Number.isFinite(Date.parse(end))
        ? new Date(end).toISOString()
        : undefined;
    // Preserve a confirmed rental even if cost evidence is missing/unexpected.
    // The customer can never be charged more than the signed quote.
    return {
      rentalId: id,
      phoneNumber: `+${number}`,
      priceMicroUsd: price ?? undefined,
      expiresAt,
    };
  }

  async #rental(
    action: 'rental-status' | 'cancel-rental',
    id: string,
  ): Promise<NumberStatus> {
    if (!/^\d{1,30}$/.test(id))
      throw new NumberProviderError(false, 'Invalid number order.');
    try {
      const response = await this.#fetch(
        `https://getatext.com/api/v1/${action}${this.tier === 'premium' ? '-premium' : ''}`,
        {
          method: 'POST',
          headers: { Auth: this.#key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        },
      );
      const payload = await response.json();
      const row = object(payload);
      if (
        !response.ok &&
        action === 'cancel-rental' &&
        typeof row?.errors === 'string' &&
        /wait|too early|5 min|five min|locked/i.test(row.errors)
      )
        return { state: 'locked' };
      if (!response.ok) return { state: 'unknown' };
      return normalizeRentalResponse(payload, id);
    } catch {
      return { state: 'unknown' };
    }
  }
  status(id: string) {
    return this.#rental('rental-status', id);
  }
  cancel(id: string) {
    return this.#rental('cancel-rental', id);
  }
}

export function normalizeRentalResponse(
  value: unknown,
  expectedId: string,
): NumberStatus {
  const row = object(value);
  if (
    !row ||
    String(row.id) !== expectedId ||
    (row.errors != null && row.errors !== 'null' && row.errors !== '')
  )
    return { state: 'unknown' };
  const code =
    typeof row.code === 'string' || typeof row.code === 'number'
      ? String(row.code).trim()
      : '';
  if (
    code &&
    code !== 'null' &&
    code.length <= 512 &&
    !/[\u0000-\u001f]/.test(code)
  )
    return { state: 'received', code };
  if (
    row.status === 'cancelled' &&
    (row.code === null || row.code === undefined)
  )
    return { state: 'cancelled' };
  if (row.status === 'active' && (row.code === null || row.code === undefined))
    return { state: 'waiting' };
  return { state: 'unknown' };
}
