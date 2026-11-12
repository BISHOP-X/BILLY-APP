import { NumberProviderError, usdMicros } from "./getatext.ts";

// PVA Developers API, 2026-11-12. Server-only; never log credentials or SMS.
export type PvaService = {
  id: string;
  name: string;
  country: string;
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
  service(id: string): Promise<PvaService>;
  inventory(id: string): Promise<{ code: string; name: string }[]>;
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
    // Owner decision: US/Canada LTR belongs exclusively to SMSBUS. The API
    // currently offers per-service LTR only for US and GB; never infer others.
    if (duration && country !== "GB") continue;
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
  if (
    row.serviceId !== expected.serviceId ||
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
        [400, 401, 403, 404, 422, 429].includes(response.status) &&
        json.success === false;
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
  async service(id: string) {
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
  async inventory(id: string) {
    if (!/^[a-f0-9]{24}$/.test(id)) {
      throw new NumberProviderError(false, "Invalid service.");
    }
    const data = record(
      (await this.call(`inventory?serviceId=${id}&type=STR`)).data,
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
    if (selection.duration && selection.country !== "GB") {
      throw new NumberProviderError(false, "This rental is unavailable.");
    }
    const service = {
      serviceId: selection.serviceId,
      ...(selection.state ? { state: selection.state } : {}),
    };
    const reply = await this.call(
      selection.duration ? "purchase-ltr" : "purchase",
      selection.duration
        ? { ...service, duration: selection.duration }
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
