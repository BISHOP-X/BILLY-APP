const MAX_BODY_BYTES = 64 * 1024;
const MAX_SAFE_MINOR = 9_007_199_254_740_991;

const FAILURE_MARKERS = [
  "fail",
  "reverse",
  "refund",
  "cancel",
  "declin",
  "reject",
  "chargeback",
] as const;

const DEFAULT_CREDITABLE_STATUSES = new Set([
  "completed",
  "paid",
  "settled",
  "success",
  "successful",
  "verified",
]);

type JsonRecord = Record<string, unknown>;

export type PocketFiWebhookOutcome =
  | "conflict"
  | "credited"
  | "duplicate"
  | "manual_review"
  | "retryable";

export type PocketFiWebhookDatabase = {
  processTransfer(input: {
    accountNumber: string;
    amountMinor: number;
    payloadDigest: string;
    providerReference: string;
    providerStatus: string;
  }): Promise<{
    outcome: PocketFiWebhookOutcome;
    transactionId: string | null;
  }>;
};

export type PocketFiWebhookDependencies = {
  allowStatusless: boolean;
  creditableStatuses?: ReadonlySet<string>;
  database: PocketFiWebhookDatabase;
  mode: "disabled" | "live";
  signatureSecret: string;
};

export type PocketFiWebhookEvent = {
  accountNumber: string;
  amountMinor: number;
  currency: "NGN";
  providerReference: string;
  providerStatus: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedRecord(value: JsonRecord, key: string): JsonRecord {
  return isRecord(value[key]) ? value[key] as JsonRecord : {};
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) =>
    value !== undefined && value !== null && value !== ""
  );
}

function firstStatus(...values: unknown[]): string {
  const value = values.find((candidate) =>
    typeof candidate === "string" && candidate.trim().length > 0
  );
  return normalizeStatus(value);
}

function normalizeAccountNumber(value: unknown): string {
  const accountNumber = String(value ?? "").trim();
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new Error("invalid_account_number");
  }
  return accountNumber;
}

function normalizeReference(value: unknown): string {
  const reference = String(value ?? "").trim();
  if (!reference || reference.length > 160) {
    throw new Error("invalid_reference");
  }
  return reference;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().slice(0, 80);
}

export function parseNairaMinor(value: unknown): number {
  const text = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : String(value ?? "").trim();
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error("invalid_amount");

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const amountMinor = whole * 100 + fraction;
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    amountMinor > MAX_SAFE_MINOR
  ) {
    throw new Error("invalid_amount");
  }
  return amountMinor;
}

export function parsePocketFiWebhookEvent(
  payload: unknown,
): PocketFiWebhookEvent {
  if (!isRecord(payload)) throw new Error("invalid_payload");
  const data = isRecord(payload.data) ? payload.data : payload;
  const order = nestedRecord(data, "order");
  const transaction = nestedRecord(data, "transaction");

  const accountNumber = normalizeAccountNumber(firstPresent(
    data.account_number,
    data.accountNumber,
    data.virtual_account,
    data.virtualAccountNumber,
    data.destinationAccount,
  ));
  const providerReference = normalizeReference(firstPresent(
    transaction.reference,
    transaction.id,
    data.reference,
    data.transactionReference,
    data.transaction_reference,
    data.transactionId,
    data.transaction_id,
    data.sessionId,
    data.session_id,
    payload.reference,
  ));
  const amountMinor = parseNairaMinor(firstPresent(order.amount, data.amount));
  const currency = String(firstPresent(data.currency, order.currency, "NGN"))
    .trim()
    .toUpperCase();
  if (currency !== "NGN") throw new Error("invalid_currency");

  return {
    accountNumber,
    amountMinor,
    currency: "NGN",
    providerReference,
    providerStatus: firstStatus(
      data.status,
      order.status,
      transaction.status,
      payload.event,
      payload.eventType,
      payload.event_type,
      payload.type,
    ),
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes))),
  );
}

async function expectedSignature(
  bytes: Uint8Array,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-512", name: "HMAC" },
    false,
    ["sign"],
  );
  return bytesToHex(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(bytes))),
  );
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hasValidSignature(
  bytes: Uint8Array,
  signature: string,
  secret: string,
): Promise<boolean> {
  const normalized = signature.trim().toLowerCase().replace(/^sha512=/, "");
  if (!/^[a-f0-9]{128}$/.test(normalized)) return false;
  return timingSafeHexEqual(await expectedSignature(bytes, secret), normalized);
}

function signatureFrom(request: Request): string {
  for (
    const name of [
      "pocketfi_signature",
      "x-pocketfi-signature",
      "x-webhook-signature",
      "x-signature",
    ]
  ) {
    const value = request.headers.get(name);
    if (value) return value;
  }
  return "";
}

function json(status: number, body: JsonRecord): Response {
  return Response.json(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });
}

function isNegativeStatus(status: string): boolean {
  return FAILURE_MARKERS.some((marker) => status.includes(marker));
}

export function createPocketFiWebhookHandler(
  dependencies: PocketFiWebhookDependencies,
): (request: Request) => Promise<Response> {
  const secret = dependencies.signatureSecret.trim();
  const creditableStatuses = dependencies.creditableStatuses ??
    DEFAULT_CREDITABLE_STATUSES;

  return async (request) => {
    if (request.method !== "POST") {
      return json(405, { code: "method_not_allowed", ok: false });
    }
    if (dependencies.mode !== "live" || secret.length < 16) {
      return json(503, { code: "webhook_disabled", ok: false });
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return json(413, { code: "payload_too_large", ok: false });
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.byteLength > MAX_BODY_BYTES) {
      return json(bytes.length ? 413 : 400, {
        code: bytes.length ? "payload_too_large" : "empty_payload",
        ok: false,
      });
    }

    const signature = signatureFrom(request);
    if (!signature || !await hasValidSignature(bytes, signature, secret)) {
      return json(401, { code: "invalid_signature", ok: false });
    }

    let event: PocketFiWebhookEvent;
    try {
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      event = parsePocketFiWebhookEvent(payload);
    } catch (error) {
      return json(400, {
        code: error instanceof Error ? error.message : "invalid_payload",
        ok: false,
      });
    }

    if (isNegativeStatus(event.providerStatus)) {
      return json(200, { code: "non_creditable_event", ok: true });
    }
    if (
      event.providerStatus
        ? !creditableStatuses.has(event.providerStatus)
        : !dependencies.allowStatusless
    ) {
      return json(422, { code: "unconfirmed_event_status", ok: false });
    }

    const payloadDigest = await sha256Hex(bytes);
    let result: Awaited<ReturnType<PocketFiWebhookDatabase["processTransfer"]>>;
    try {
      result = await dependencies.database.processTransfer({
        accountNumber: event.accountNumber,
        amountMinor: event.amountMinor,
        payloadDigest,
        providerReference: event.providerReference,
        providerStatus: event.providerStatus,
      });
    } catch {
      return json(503, { code: "processing_unavailable", ok: false });
    }

    switch (result.outcome) {
      case "credited":
      case "duplicate":
        return json(200, { code: result.outcome, ok: true });
      case "manual_review":
        return json(202, { code: "manual_review", ok: true });
      case "conflict":
        return json(409, { code: "evidence_conflict", ok: false });
      case "retryable":
        return json(503, { code: "processing_retryable", ok: false });
    }
  };
}
