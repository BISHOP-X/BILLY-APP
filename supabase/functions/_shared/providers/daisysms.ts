import {
  normalizeNumberStatus,
  type NumberAdapter,
  type NumberAllocation,
  NumberProviderError,
  type NumberService,
  type NumberStatus,
  usdDecimal,
  usdMicros,
} from "./getatext.ts";

const BASE_URL = "https://daisysms.io/stubs/handler_api.php";
// Verified US routing aliases from Active Store's *active* new-daisy adapter.
// These identify products, not a cached catalogue: prices/stock remain live.
const US_WHATSAPP = ["whatsapp", "whatsapp_re", "wa"] as const;
const DEFINITIVE_REJECTIONS = new Set([
  "BAD_KEY",
  "BAD_SERVICE",
  "NO_NUMBERS",
  "NO_MONEY",
  "MAX_PRICE_EXCEEDED",
  "TOO_MANY_ACTIVE_RENTALS",
]);
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeDaisyUsServices(payload: unknown): NumberService[] {
  const root = record(payload);
  if (!Object.keys(root).length) {
    throw new NumberProviderError(false, "Number services are unavailable.");
  }
  const result: NumberService[] = [];
  for (const id of US_WHATSAPP) {
    const service = record(root[id]);
    const raw = record(service["187"] ?? record(root["187"])[id] ?? service);
    const price = usdMicros(raw.cost);
    const stock = Number(raw.count);
    if (!price || !Number.isSafeInteger(stock) || stock < 0) continue;
    result.push({
      serviceId: id,
      name: "WhatsApp",
      priceMicroUsd: price,
      stock,
      multipleSms: [true, 1, "1", "true"].includes(
        (raw.repeatable ?? raw.multi) as string | number | boolean,
      ),
    });
  }
  return result;
}

/** DaisySMS.io only. Never logs URLs (the provider requires a key in the query). */
export class DaisySmsAdapter implements NumberAdapter {
  readonly tier = "standard" as const;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  #cache?: { until: number; services: NumberService[] };
  #inflight?: Promise<NumberService[]>;
  constructor(key: string, request: typeof fetch = fetch) {
    if (!key.trim()) throw new Error("DAISYSMS_API_KEY is required.");
    this.#key = key.trim();
    this.#fetch = request;
  }
  async #request(params: Record<string, string>, purchase = false) {
    const url = new URL(BASE_URL);
    url.searchParams.set("api_key", this.#key);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    try {
      const response = await this.#fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.text()).trim();
      // A gateway error or timeout must not cause a retry/fallback purchase.
      if (!response.ok) throw new Error();
      return {
        body,
        price: usdMicros(response.headers.get("X-Price") ?? undefined),
      };
    } catch {
      throw new NumberProviderError(
        purchase,
        purchase
          ? "We are confirming your number request. Check your orders before trying again."
          : "Number services are temporarily unavailable.",
      );
    }
  }
  async services(): Promise<NumberService[]> {
    if (this.#cache && this.#cache.until > Date.now()) {
      return this.#cache.services;
    }
    if (!this.#inflight) {
      this.#inflight = (async () => {
        try {
          const response = await this.#request({
            action: "getPricesVerification",
          });
          let payload: unknown;
          try {
            payload = JSON.parse(response.body);
          } catch {
            throw new NumberProviderError(
              false,
              "Number services are unavailable.",
            );
          }
          const services = normalizeDaisyUsServices(payload);
          this.#cache = { until: Date.now() + 30_000, services };
          return services;
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
    if (
      !(US_WHATSAPP as readonly string[]).includes(serviceId) ||
      maximumMicroUsd <= 0
    ) {
      throw new NumberProviderError(
        false,
        "This US number service is unavailable.",
      );
    }
    const response = await this.#request({
      action: "getNumber",
      service: serviceId,
      country: "187",
      max_price: usdDecimal(maximumMicroUsd),
    }, true);
    if (DEFINITIVE_REJECTIONS.has(response.body)) {
      throw new NumberProviderError(
        false,
        "No number was allocated. Try another service.",
      );
    }
    const match = /^ACCESS_NUMBER:(\d{1,30}):(1\d{10})$/.exec(response.body);
    if (!match) {
      throw new NumberProviderError(
        true,
        "We are confirming your number request.",
      );
    }
    // Preserve allocated number evidence even if the cost header is absent.
    return {
      rentalId: match[1],
      phoneNumber: `+${match[2]}`,
      priceMicroUsd: response.price,
    };
  }
  async #status(id: string, cancel: boolean): Promise<NumberStatus> {
    if (!/^\d{1,30}$/.test(id)) {
      throw new NumberProviderError(false, "Invalid number order.");
    }
    try {
      const { body } = await this.#request(
        cancel
          ? { action: "setStatus", id, status: "8" }
          : { action: "getStatus", id },
      );
      // ACCESS_READY / NO_ACTIVATION are not proof of a refund.
      return normalizeNumberStatus(body);
    } catch {
      return { state: "unknown" };
    }
  }
  status(id: string) {
    return this.#status(id, false);
  }
  cancel(id: string) {
    return this.#status(id, true);
  }
}
