import { NumberProviderError, usdMicros } from "./getatext.ts";

// PVA Developers API, 2026-11-12. Server-only; never log credentials or SMS.
export type PvaService = {
  id: string;
  name: string;
  country: string;
  kind?: "general";
  prices: Record<string, number>;
  stock: Record<string, number>;
};
export type PvaSelection = {
  serviceId: string;
  country: string;
  duration: number;
  state?: string;
};
export type PvaOutcome = {
  state:
    | "allocated"
    | "pending"
    | "received"
    | "waiting"
    | "cancelled"
    | "expired"
    | "unknown"
    | "rejected"
    | "throttled";
  rentalId?: string;
  phoneNumber?: string;
  priceMicroUsd?: number;
  expiresAt?: string;
  canCancel?: boolean;
  code?: string;
  messages?: {
    id: string;
    body: string;
    sender: string;
    receivedAt: string | null;
  }[];
};
export type PvaReply = { outcome: PvaOutcome; raw: string };
export interface PvaProvider {
  services(): Promise<PvaService[]>;
  plans(): Promise<PvaService[]>;
  service(id: string, country?: string): Promise<PvaService>;
  inventory(id: string, duration?: number): Promise<{ code: string; name: string }[]>;
  purchase(selection: PvaSelection): Promise<PvaReply>;
  request(id: string, selection: PvaSelection): Promise<PvaReply>;
  flag(id: string): Promise<void>;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
export function pvaCountry(value: unknown): string {
  const code = String(value ?? "").toUpperCase();
  return code === "USA"
    ? "US"
    : code === "UK"
    ? "GB"
    : /^[A-Z]{2}$/.test(code)
    ? code
    : "";
}
export function normalizePvaService(
  value: unknown,
  detail = false,
): PvaService | undefined {
  const row = record(value),
    id = String(row._id ?? ""),
    country = pvaCountry(row.country);
  if (
    !/^[a-f0-9]{24}$/.test(id) || !country || typeof row.name !== "string" ||
    !row.name.trim()
  ) return;
  const prices: Record<string, number> = {}, stock: Record<string, number> = {};
  for (const duration of [0, 3, 7, 14, 30]) {
    // Only US/Canada 30 days belongs to SMSBoss. Other per-service LTR is
    // documented for US/GB only; prices and stock still come from the provider.
    if (duration && country !== "GB" && !(country === "US" && duration !== 30)) continue;
    const price = usdMicros(
      row[duration ? `LTR${duration}price` : detail ? "price" : "STRprice"],
    );
    const count = Number(row[duration ? "LTRstock" : "STRstock"]);
    if (!price || !Number.isSafeInteger(count) || count <= 0) continue;
    prices[String(duration)] = price;
    stock[String(duration)] = count;
  }
  return { id, name: row.name.trim().slice(0, 160), country, prices, stock };
}
// Protocol validation, not a price catalogue. Availability/prices are read live.
export function validPvaSelection(s: PvaSelection): boolean {
  if (s.serviceId === "ALL_SERVICES") {
    const days: Record<string, number[]> = {US:[28], GB:[30,90,180,365], HK:[30,180], ID:[30,180], AU:[30]};
    return !s.state && !!days[s.country]?.includes(s.duration);
  }
  return /^[a-f0-9]{24}$/.test(s.serviceId) && /^[A-Z]{2}$/.test(s.country) &&
    (!s.state || (s.country === "US" && /^[A-Z]{2}$/.test(s.state))) &&
    (s.duration === 0 || (s.country === "US" && [3,7,14].includes(s.duration)) ||
      (s.country === "GB" && [3,7,14,30].includes(s.duration)));
}
export function normalizePvaPlans(value: unknown): PvaService[] {
  const data = record(value);
  if (!Array.isArray(data.getAllServicesCountries)) throw new NumberProviderError(false, "Long rentals are temporarily unavailable.");
  return data.getAllServicesCountries.flatMap((item) => {
    const countryRow = record(item), country = pvaCountry(countryRow.country);
    const source = record(data[country]);
    if (countryRow.enabled !== true || source.available !== true) return [];
    if (!Array.isArray(source.plans)) throw new NumberProviderError(false, "Long rental pricing is unavailable.");
    const prices: Record<string, number> = {};
    for (const item of source.plans) {
      const plan = record(item), duration = Number(plan.durationDays), price = usdMicros(plan.price);
      if (!validPvaSelection({serviceId:"ALL_SERVICES",country,duration})) continue;
      if (!price || prices[String(duration)]) throw new NumberProviderError(false, "Long rental pricing is unavailable.");
      prices[String(duration)] = price;
    }
    return Object.keys(prices).length ? [{id:"ALL_SERVICES", name:"All services", country, kind:"general" as const, prices, stock:{}}] : [];
  });
}
function iso(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : undefined;
}
export function normalizePvaRequest(
  value: unknown,
  expected: PvaSelection,
  expectedId?: string,
): PvaOutcome {
  const row = record(value), rentalId = String(row._id ?? "");
  if (
    !/^[a-f0-9]{24}$/.test(rentalId) || (expectedId && rentalId !== expectedId)
  ) return { state: "unknown" };
  const unknown: PvaOutcome = { state: "unknown", rentalId };
  // Live dedicated rentals replace ALL_SERVICES with a generated service ID.
  // Match both product labels and the exact duration, in addition to the pinned
  // rental ID, country/type and price ceiling enforced during settlement.
  const dedicatedMatch = expected.serviceId === "ALL_SERVICES" &&
    /^[a-f0-9]{24}$/.test(String(row.serviceId)) &&
    String(row.serviceName).toLowerCase() === "all services" &&
    String(row.rentalWebsite).toLowerCase() === "all services" &&
    row.duration === expected.duration;
  if (
    (row.serviceId !== expected.serviceId && !dedicatedMatch) ||
    (row.duration !== undefined && row.duration !== expected.duration) ||
    row.autoRenewEnable === true ||
    pvaCountry(row.country) !== expected.country ||
    row.numberType !== (expected.duration ? "LTR" : "STR")
  ) return unknown;
  const priceMicroUsd = usdMicros(row.amount);
  if (priceMicroUsd === undefined) return unknown;
  const status = row.status;
  const messages = (Array.isArray(row.codes) ? row.codes : []).slice(-100)
    .flatMap((raw) => {
      const m = record(raw);
      if (
        m.requestId !== rentalId || typeof m._id !== "string" ||
        typeof m.message !== "string" || !m.message.trim()
      ) return [];
      return [{
        id: m._id,
        body: m.message.slice(0, 10000),
        sender: typeof m.serviceName === "string"
          ? m.serviceName.slice(0, 100)
          : "SMS",
        receivedAt: iso(m.createdAt) ?? null,
      }];
    });
  const pins = (Array.isArray(row.codes) ? row.codes : []).flatMap((raw) => {
    const m = record(raw);
    return m.requestId === rentalId &&
        ["string", "number"].includes(typeof m.pin) && String(m.pin).trim()
      ? [String(m.pin).slice(0, 512)]
      : [];
  });
  // Refund policy: unused STR receives automatic store credit at expiry. Never
  // infer this from TIMEOUT alone: live TIMEOUT rows can have received SMS.
  // LTR has a separate flag window; no automatic full refund is inferred there.
  if (status === "FLAGGED") {
    return messages.length || Number(row.messageCounter) > 0
      ? unknown
      : { state: "cancelled", rentalId };
  }
  if (
    status === "TIMEOUT" && !expected.duration && row.messageCounter === 0 &&
    Array.isArray(row.codes) && row.codes.length === 0 && iso(row.endTime) &&
    Date.parse(String(row.endTime)) <= Date.now()
  ) {
    return { state: "cancelled", rentalId };
  }
  if (status === "PENDING") {
    return { state: "pending", rentalId, priceMicroUsd };
  }
  const phone = String(row.number ?? ""), expiresAt = iso(row.endTime);
  if (
    !/^\+[1-9][0-9]{6,14}$/.test(phone) || !expiresAt ||
    !["RESERVED", "COMPLETED", "TIMEOUT"].includes(String(status))
  ) return unknown;
  const code = pins.at(-1) ?? messages.at(-1)?.body.slice(0, 512);
  return {
    state: status === "TIMEOUT" || (code && Date.parse(expiresAt) <= Date.now())
      ? "expired"
      : code
      ? "received"
      : "allocated",
    rentalId,
    phoneNumber: phone,
    priceMicroUsd,
    expiresAt,
    messages,
    ...(code ? { code } : {}),
    canCancel: row.allowFlag === true && !messages.length && !code &&
      !Number(row.messageCounter),
  };
}

export class PvadealsAdapter implements PvaProvider {
  constructor(private key: string, private fetcher: typeof fetch = fetch) {}
  private async call(
    path: string,
    body?: unknown,
    paid = false,
  ): Promise<{ data: unknown; raw: string }> {
    let response: Response, raw: string;
    try {
      response = await this.fetcher(
        `https://prod-v3.pvadeals.com/v3/api/${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${this.key}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(22_000),
        },
      );
      raw = await response.text();
    } catch {
      throw new NumberProviderError(paid, "Number service did not respond.");
    }
    if (raw.length > 4_000_000) {
      throw new NumberProviderError(paid, "Unexpected number response.");
    }
    let json: Record<string, unknown>;
    try {
      json = record(JSON.parse(raw));
    } catch {
      throw new NumberProviderError(
        paid,
        "Unexpected number response.",
        undefined,
        {
          code: "INVALID_JSON",
          httpStatus: response.status,
          response: raw.slice(0, 8000),
        },
      );
    }
    if (!response.ok || json.success !== true) {
      const refusal =
        [400, 401, 402, 403, 404, 409, 422, 429].includes(response.status) &&
        (json.success === false || (response.status === 429 && json.status === 429 && typeof json.retryAfter === 'number'));
      throw new NumberProviderError(
        paid && !refusal,
        "This number could not be reserved. Please try another service.",
        undefined,
        {
          code: response.status === 429 && refusal
            ? "PVA_THROTTLED"
            : "PVA_REQUEST_FAILED",
          httpStatus: response.status,
          response: raw.slice(0, 8000),
        },
      );
    }
    return { data: json.data, raw };
  }
  async services() {
    const { data } = await this.call("services/all");
    const rows = record(data).services;
    if (!Array.isArray(rows) || rows.length > 12000) {
      throw new NumberProviderError(false, "Number catalogue unavailable.");
    }
    const result = rows.map((row) => normalizePvaService(row)).filter((
      row,
    ): row is PvaService => !!row);
    if (new Set(result.map((s) => s.id)).size !== result.length) {
      throw new NumberProviderError(false, "Number catalogue unavailable.");
    }
    return result;
  }
  async plans(): Promise<PvaService[]> {
    // Same public, read-only feed used by PVA's own storefront (verified
    // 2026-11-12). No API key/session is sent to this public pricing endpoint.
    // Do not fall back to documented prices if this contract changes.
    try {
      const response = await this.fetcher("https://prod-v3.pvadeals.com/graphql", {
        method:"POST", redirect:"error", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({query:'query { getAllServicesCountries US:getAllServicesPrice(country:"US") GB:getAllServicesPrice(country:"UK") HK:getAllServicesPrice(country:"HK") ID:getAllServicesPrice(country:"ID") CA:getAllServicesPrice(country:"CA") AU:getAllServicesPrice(country:"AU") }'}),
        signal:AbortSignal.timeout(12_000),
      });
      const raw = await response.text();
      if (!response.ok || raw.length > 100_000) throw new Error("Bad plan response");
      const json = record(JSON.parse(raw));
      if (json.errors) throw new Error("Plan query failed");
      return normalizePvaPlans(json.data);
    } catch {
      throw new NumberProviderError(false, "Long rental pricing is temporarily unavailable. Please try again.");
    }
  }
  async service(id: string, country?: string) {
    if (id === "ALL_SERVICES") {
      const plan = (await this.plans()).find((row) => row.country === country);
      if (!plan) throw new NumberProviderError(false, "This long rental is unavailable.");
      return plan;
    }
    if (!/^[a-f0-9]{24}$/.test(id)) {
      throw new NumberProviderError(false, "Invalid service.");
    }
    const row = normalizePvaService(
      (await this.call(`service/${id}`)).data,
      true,
    );
    if (!row || row.id !== id) {
      throw new NumberProviderError(false, "Service is unavailable.");
    }
    return row;
  }
  async inventory(id: string, duration = 0) {
    if (!/^[a-f0-9]{24}$/.test(id)) {
      throw new NumberProviderError(false, "Invalid service.");
    }
    const data = record(
      (await this.call(`inventory?serviceId=${id}&type=${duration ? "LTR" : "STR"}`)).data,
    );
    return Object.entries(record(data.countsByState)).flatMap(
      ([code, value]) => {
        const row = record(value);
        return /^[A-Z]{2}$/.test(code) && Number(row.count) > 0 &&
            typeof row.name === "string"
          ? [{ code, name: row.name.slice(0, 80) }]
          : [];
      },
    );
  }
  async purchase(selection: PvaSelection): Promise<PvaReply> {
    if (!validPvaSelection(selection)) {
      throw new NumberProviderError(false, "This rental is unavailable.");
    }
    const service = {
      serviceId: selection.serviceId,
      ...(selection.state ? { state: selection.state } : {}),
    };
    const reply = await this.call(
      selection.duration ? "purchase-ltr" : "purchase",
      selection.duration
        ? { ...service, duration: selection.duration, ...(selection.serviceId === "ALL_SERVICES" ? {country:selection.country === "GB" ? "UK" : selection.country} : {}) }
        : { services: [service] },
      true,
    );
    const requests = record(reply.data).requests;
    const row = selection.duration
      ? reply.data
      : Array.isArray(requests) && requests.length === 1
      ? requests[0]
      : null;
    return { raw: reply.raw, outcome: normalizePvaRequest(row, selection) };
  }
  async request(id: string, selection: PvaSelection): Promise<PvaReply> {
    if (!/^[a-f0-9]{24}$/.test(id)) {
      throw new NumberProviderError(false, "Invalid rental.");
    }
    const reply = await this.call(`request/${id}`);
    return {
      raw: reply.raw,
      outcome: normalizePvaRequest(reply.data, selection, id),
    };
  }
  async flag(id: string) {
    if (!/^[a-f0-9]{24}$/.test(id)) {
      throw new NumberProviderError(false, "Invalid rental.");
    }
    await this.call(`flag/${id}`, {});
  }
}
