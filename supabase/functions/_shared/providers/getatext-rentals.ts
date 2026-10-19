import {
  type NumberAllocation,
  NumberProviderError,
  usdDecimal,
  usdMicros,
} from './getatext.ts';

// Provider contract checked against https://getatext.com/api-docs on 2026-10-17.
// All dates without an offset remain display-only; never guess their timezone.
export type RentalKind = 'short' | 'general' | 'service';
export type RentalOffer = {
  kind: RentalKind;
  serviceId: string;
  name: string;
  period: string;
  periodLabel: string;
  microUsd: number;
  stock?: number;
  nonRefundableMicroUsd?: number;
};
export type RentalRoute = {
  kind: RentalKind;
  serviceId: string;
  rentalId: string;
  phoneNumber: string;
  period: string;
};
export type RentalMessage = {
  body: string;
  sender: string;
  receivedAt?: string;
};
export type RentalRecord = NumberAllocation & {
  endLabel?: string;
  state: 'active' | 'expired' | 'cancelled' | 'unknown';
  serviceId?: string;
};
export interface ExtendedNumberAdapter {
  offers(): Promise<RentalOffer[]>;
  buy(offer: RentalOffer): Promise<RentalRecord>;
  multiple(
    services: { serviceId: string; name: string }[],
    maximum: number,
  ): Promise<NumberAllocation[]>;
  specific(
    number: string,
    service: string,
    maximum: number,
  ): Promise<NumberAllocation>;
  inspect(
    route: RentalRoute,
  ): Promise<{ rental?: RentalRecord; messages: RentalMessage[] }>;
  renew(route: RentalRoute): Promise<RentalRecord>;
  recoverable(route: RentalRoute): Promise<RentalOffer[]>;
  recover(route: RentalRoute, offer: RentalOffer): Promise<RentalRecord>;
  cancelLong(route: RentalRoute): Promise<RentalRecord>;
  another(id: string): Promise<boolean>;
  finish(id: string): Promise<boolean>;
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown>
    : {};
const rows = (v: unknown) => Array.isArray(v) ? v.slice(0, 10_000) : [];
const validId = (v: unknown) => /^\d{1,30}$/.test(String(v ?? ''));
const code = (v: unknown) =>
  typeof v === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(v);
const error = (uncertain = false) =>
  new NumberProviderError(
    uncertain,
    uncertain
      ? 'We are confirming this request. Check My numbers before trying again.'
      : 'This option is not available right now. Refresh and try another option.',
  );
export function phoneDigits(phone: string): string {
  const digits = phone.replace(/^\+/, '');
  if (!/^1?\d{10}$/.test(digits)) throw error();
  return digits.length === 11 ? digits.slice(1) : digits;
}
export function rentalRecord(raw: unknown): RentalRecord {
  const r = record(raw);
  if (!validId(r.id) || !/^1?\d{10}$/.test(String(r.number ?? ''))) {
    throw error(true);
  }
  const end = typeof r.end_time === 'string' ? r.end_time : '';
  const expiresAt =
    /(?:Z|[+-]\d{2}:\d{2})$/.test(end) && Number.isFinite(Date.parse(end))
      ? new Date(end).toISOString()
      : undefined;
  return {
    rentalId: String(r.id),
    phoneNumber: `+1${phoneDigits(String(r.number))}`,
    priceMicroUsd: usdMicros(r.price ?? r.cost),
    expiresAt,
    endLabel: /^\d{4}-\d{2}-\d{2}(?:[ T][\d:.+Z-]+)?$/.test(end)
      ? end
      : undefined,
    state: /^active$/i.test(String(r.status))
      ? 'active'
      : /^expired$/i.test(String(r.status))
      ? 'expired'
      : /^cancelled$/i.test(String(r.status))
      ? 'cancelled'
      : 'unknown',
    serviceId: code(r.api_name) ? String(r.api_name) : undefined,
  };
}
export function longOffers(general: unknown, service: unknown): RentalOffer[] {
  const g = record(general), s = record(service), result: RentalOffer[] = [];
  if (g.status === 'success') {
    for (const [period, cost] of Object.entries(record(g.prices))) {
      const amount = usdMicros(cost);
      if (
        code(period) && amount && Number.isSafeInteger(g.stock) &&
        Number(g.stock) >= 0
      ) {
        result.push({
          kind: 'general',
          serviceId: 'general',
          name: 'General SMS number',
          period,
          periodLabel: period,
          microUsd: amount,
          stock: Number(g.stock),
        });
      }
    }
  }
  if (s.status === 'success') {
    for (const raw of rows(s.service_long_rental_prices)) {
      const item = record(raw);
      if (!code(item.api_name) || typeof item.service_name !== 'string') {
        continue;
      }
      for (const rawPrice of rows(item.prices)) {
        const price = record(rawPrice), amount = usdMicros(price.cost);
        if (code(price.period) && amount) {
          result.push({
            kind: 'service',
            serviceId: String(item.api_name),
            name: item.service_name.slice(0, 160),
            period: String(price.period),
            periodLabel: String(price.period),
            microUsd: amount,
          });
        }
      }
    }
  }
  return result;
}
export class GetatextRentals implements ExtendedNumberAdapter {
  #cache?: { until: number; offers: RentalOffer[] };
  #inflight?: Promise<RentalOffer[]>;
  constructor(
    private key: string,
    private request: typeof fetch = fetch,
    private premium = true,
  ) {}
  async #json(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response, payload: Record<string, unknown>;
    try {
      response = await this.request(`https://getatext.com/api/v1/${path}`, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        headers: {
          Auth: this.key,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(body ? 20_000 : 10_000),
      });
      payload = record(await response.json());
    } catch {
      throw error(!!body);
    }
    if (
      [400, 403, 404, 422].includes(response.status) &&
      typeof payload.errors === 'string'
    ) throw error();
    if (!response.ok || payload.status !== 'success') throw error(!!body);
    return payload;
  }
  async offers() {
    if (this.#cache && this.#cache.until > Date.now()) {
      return this.#cache.offers;
    }
    if (!this.#inflight) {
      this.#inflight = (async () => {
        // A stock/error response on one product must not hide the other product.
        const values = await Promise.allSettled([
          this.#json('long-rentals/prices'),
          this.#json('service-long-rentals/prices'),
        ]);
        if (values.every((v) => v.status === 'rejected')) throw error();
        const offers = longOffers(
          ...values.map((v) => v.status === 'fulfilled' ? v.value : {}) as [
            unknown,
            unknown,
          ],
        );
        this.#cache = { until: Date.now() + 30_000, offers };
        return offers;
      })().finally(() => {
        this.#inflight = undefined;
      });
    }
    return this.#inflight;
  }
  #base(kind: RentalKind) {
    return kind === 'general' ? 'long-rentals' : 'service-long-rentals';
  }
  #extract(payload: Record<string, unknown>, kind: RentalKind) {
    return rentalRecord(
      payload[kind === 'general' ? 'long_rental' : 'service_long_rental'],
    );
  }
  async buy(offer: RentalOffer) {
    const result = this.#extract(
      await this.#json(this.#base(offer.kind), {
        auto_renew: false,
        ...(offer.kind === 'general'
          ? { rental_time: offer.period }
          : { service: offer.serviceId, period: offer.period }),
      }),
      offer.kind,
    );
    if (
      result.state !== 'active' ||
      (result.serviceId && offer.kind === 'service' &&
        result.serviceId !== offer.serviceId)
    ) throw error(true);
    return result;
  }
  async multiple(
    services: { serviceId: string; name: string }[],
    maximum: number,
  ) {
    const payload = await this.#json(
      `rent-multiple-services${this.premium ? '-premium' : ''}`,
      {
        services: services.map((s) => s.serviceId).join(','),
        max_price: Number(usdDecimal(maximum)),
      },
    );
    const rentals = rows(payload.rentals).map(record);
    // Never rely on response array ordering to assign a customer's service.
    if (rentals.length !== services.length) throw error(true);
    const assigned = services.map((service) => {
      const matches = rentals.filter((r) =>
        String(r.service_name).toLowerCase() === service.name.toLowerCase()
      );
      if (matches.length !== 1) throw error(true);
      return rentalRecord(matches[0]);
    });
    if (
      new Set(assigned.map((r) => r.rentalId)).size !== services.length ||
      new Set(assigned.map((r) => r.phoneNumber)).size !== 1
    ) throw error(true);
    return assigned;
  }
  async specific(number: string, service: string, maximum: number) {
    const result = rentalRecord(
      await this.#json('rent-specific-number', {
        number: phoneDigits(number),
        service,
        max_price: Number(usdDecimal(maximum)),
      }),
    );
    if (phoneDigits(result.phoneNumber) !== phoneDigits(number)) {
      throw error(true);
    }
    return result;
  }
  async inspect(route: RentalRoute) {
    const base = this.#base(route.kind);
    const list = await this.#json(base);
    const match = rows(
      list[route.kind === 'general' ? 'long_rentals' : 'service_long_rentals'],
    ).map(record)
      .find((r) =>
        String(r.id) === route.rentalId &&
        `+1${String(r.number).replace(/^1(?=\d{10}$)/, '')}` ===
          route.phoneNumber &&
        (route.kind === 'general' || r.api_name === route.serviceId)
      );
    if (!match) return { messages: [] }; // Absence is not cancellation/refund proof.
    const rental = rentalRecord(match);
    // Service message endpoints identify by phone, not rental ID. After expiry
    // that phone can belong to a different customer. Only serve stored history.
    if (rental.state !== 'active') return { rental, messages: [] };
    const path = route.kind === 'general'
      ? `${base}/${route.rentalId}/messages`
      : `${base}/${phoneDigits(route.phoneNumber)}/messages?service=${
        encodeURIComponent(route.serviceId)
      }`;
    const payload = await this.#json(path).catch((e) => {
      if (rental.state === 'expired' || rental.state === 'cancelled') {
        return { messages: [] };
      }
      throw e;
    });
    const messages = rows(payload.messages).map(record).filter((m) =>
      typeof m.message === 'string' && m.message.length > 0 &&
      m.message.length <= 10_000 &&
      (m.number === undefined ||
        String(m.number).replace(/^1(?=\d{10}$)/, '') ===
          phoneDigits(route.phoneNumber))
    )
      .map((m) => {
        const date = String(m.received_at ?? m.rented_at ?? '');
        return {
          body: String(m.message),
          sender: String(m.sender ?? '').slice(0, 100),
          ...(/(?:Z|[+-]\d{2}:\d{2})$/.test(date) &&
              Number.isFinite(Date.parse(date))
            ? { receivedAt: new Date(date).toISOString() }
            : {}),
        };
      });
    return { rental, messages };
  }
  async renew(route: RentalRoute) {
    const base = this.#base(route.kind);
    const payload = await this.#json(
      route.kind === 'general'
        ? `${base}/${route.rentalId}/update`
        : `${base}/${phoneDigits(route.phoneNumber)}/renew`,
      route.kind === 'general'
        ? { action: 'renew' }
        : { service: route.serviceId },
    );
    const result = this.#extract(payload, route.kind);
    if (
      result.rentalId !== route.rentalId ||
      result.phoneNumber !== route.phoneNumber
    ) throw error(true);
    return result;
  }
  async recoverable(route: RentalRoute) {
    const p = await this.#json(`${this.#base(route.kind)}/retakeable`);
    const r = rows(
      p[route.kind === 'general' ? 'long_rentals' : 'service_long_rentals'],
    ).map(record).find((r) =>
      String(r.id) === route.rentalId &&
      phoneDigits(String(r.number)) === phoneDigits(route.phoneNumber) &&
      (route.kind === 'general' || r.api_name === route.serviceId)
    );
    if (!r) return [];
    return rows(r.periods).map(record).flatMap((p) => {
      const amount = usdMicros(p.total);
      const fee = usdMicros(p.fee);
      return code(p.value) && amount && fee !== undefined && fee < amount
        ? [{
          kind: route.kind,
          serviceId: route.serviceId,
          name: typeof r.service_name === 'string'
            ? r.service_name
            : 'General SMS number',
          period: String(p.value),
          periodLabel: String(p.label ?? p.value).slice(0, 80),
          microUsd: amount,
          nonRefundableMicroUsd: fee,
        }]
        : [];
    });
  }
  async recover(route: RentalRoute, offer: RentalOffer) {
    const base = this.#base(route.kind);
    const p = await this.#json(
      `${base}/${
        route.kind === 'general'
          ? route.rentalId
          : phoneDigits(route.phoneNumber)
      }/retake`,
      {
        auto_renew: false,
        ...(route.kind === 'general'
          ? { rental_time: offer.period }
          : { service: route.serviceId, period: offer.period }),
      },
    );
    const result = this.#extract(p, route.kind);
    if (
      result.phoneNumber !== route.phoneNumber ||
      result.rentalId === route.rentalId
    ) throw error(true);
    return result;
  }
  async cancelLong(route: RentalRoute) {
    const base = this.#base(route.kind);
    const result = this.#extract(
      await this.#json(
        route.kind === 'general'
          ? `${base}/${route.rentalId}/update`
          : `${base}/${phoneDigits(route.phoneNumber)}/cancel`,
        route.kind === 'general'
          ? { action: 'cancel' }
          : { service: route.serviceId },
      ),
      route.kind,
    );
    if (
      result.rentalId !== route.rentalId ||
      result.phoneNumber !== route.phoneNumber || result.state !== 'cancelled'
    ) throw error(true);
    return result;
  }
  async another(id: string) {
    if (!validId(id)) throw error();
    // POST form keeps the provider key out of URL logs. Documented compatibility API.
    try {
      const r = await this.request(
        'https://getatext.com/stubs/handler_api.php',
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          body: new URLSearchParams({
            api_key: this.key,
            action: 'setStatus',
            status: '3',
            id,
          }),
        },
      );
      return r.ok && (await r.text()).trim() === 'ACCESS_RETRY_GET';
    } catch {
      return false;
    }
  }
  async finish(id: string) {
    if (!validId(id)) throw error();
    const result = await this.#json(
      `rental-status/${id}/completed${this.premium ? '-premium' : ''}`,
      {},
    );
    return String(record(result.rental).id) === id;
  }
}
