const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 16 * 1024;
const MAX_CLAIMS_BYTES = 8 * 1024;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_TOKEN_LIFETIME_MS = 30 * 60_000;

type TokenEnvelope<T> = {
  data: T;
  exp: number;
  iat: number;
  sub: string;
  typ: string;
  v: typeof TOKEN_VERSION;
};

export class ServiceTokenError extends Error {
  constructor(message = "This secure selection is invalid or expired.") {
    super(message);
    this.name = "ServiceTokenError";
  }
}

export type ServiceTokenCodecOptions = {
  now?: () => Date;
  randomBytes?: (length: number) => Uint8Array;
};

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ServiceTokenError();
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ServiceTokenError();
  }
}

function concatenate(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function parseEnvelope<T>(
  value: Uint8Array,
  expectedType: string,
  expectedSubject: string,
  now: number,
): T {
  if (value.byteLength === 0 || value.byteLength > MAX_CLAIMS_BYTES) {
    throw new ServiceTokenError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(TEXT_DECODER.decode(value));
  } catch {
    throw new ServiceTokenError();
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
  ) {
    throw new ServiceTokenError();
  }

  const envelope = parsed as Partial<TokenEnvelope<T>>;
  if (
    envelope.v !== TOKEN_VERSION ||
    envelope.typ !== expectedType ||
    envelope.sub !== expectedSubject ||
    !Number.isSafeInteger(envelope.iat) ||
    !Number.isSafeInteger(envelope.exp) ||
    typeof envelope.iat !== "number" ||
    typeof envelope.exp !== "number" ||
    envelope.iat > now + MAX_CLOCK_SKEW_MS ||
    envelope.exp <= now ||
    envelope.exp <= envelope.iat ||
    envelope.exp - envelope.iat > MAX_TOKEN_LIFETIME_MS ||
    !("data" in envelope)
  ) {
    throw new ServiceTokenError();
  }

  return envelope.data as T;
}

function validateSecret(secret: string): Uint8Array {
  const value = String(secret ?? "");
  const encoded = TEXT_ENCODER.encode(value);
  if (encoded.byteLength < 32 || encoded.byteLength > 4096) {
    throw new Error(
      "SERVICE_API_SIGNING_SECRET must contain 32 to 4096 UTF-8 bytes.",
    );
  }
  return encoded;
}

function validateIssue(
  type: string,
  subject: string,
  ttlMs: number,
): void {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(type)) {
    throw new Error("Service token type is invalid.");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(subject)
  ) {
    throw new Error("Service token subject is invalid.");
  }
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1_000 ||
    ttlMs > MAX_TOKEN_LIFETIME_MS
  ) {
    throw new Error("Service token lifetime is invalid.");
  }
}

function encodeEnvelope<T>(
  type: string,
  subject: string,
  data: T,
  now: number,
  ttlMs: number,
): Uint8Array {
  validateIssue(type, subject, ttlMs);
  const encoded = TEXT_ENCODER.encode(JSON.stringify(
    {
      data,
      exp: now + ttlMs,
      iat: now,
      sub: subject,
      typ: type,
      v: TOKEN_VERSION,
    } satisfies TokenEnvelope<T>,
  ));
  if (encoded.byteLength > MAX_CLAIMS_BYTES) {
    throw new Error("Service token claims are too large.");
  }
  return encoded;
}

async function deriveAesKey(secret: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    asArrayBuffer(
      concatenate(TEXT_ENCODER.encode("billy-service-selection:"), secret),
    ),
  );
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function importHmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asArrayBuffer(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

function secureRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Catalog selections are encrypted with AES-GCM so provider routing remains
 * opaque to the mobile application. Quotes and validation evidence are
 * HMAC-signed so the server can safely bind user, price and expiry without a
 * client-controlled database record.
 */
export class ServiceTokenCodec {
  readonly #aesKey: Promise<CryptoKey>;
  readonly #hmacKey: Promise<CryptoKey>;
  readonly #now: () => Date;
  readonly #randomBytes: (length: number) => Uint8Array;

  constructor(secret: string, options: ServiceTokenCodecOptions = {}) {
    const validatedSecret = validateSecret(secret);
    this.#aesKey = deriveAesKey(validatedSecret);
    this.#hmacKey = importHmacKey(validatedSecret);
    this.#now = options.now ?? (() => new Date());
    this.#randomBytes = options.randomBytes ?? secureRandomBytes;
  }

  async issueOpaque<T>(
    type: string,
    subject: string,
    data: T,
    ttlMs: number,
  ): Promise<string> {
    const issuedAt = this.#now().getTime();
    const plaintext = encodeEnvelope(type, subject, data, issuedAt, ttlMs);
    const iv = this.#randomBytes(12);
    if (!(iv instanceof Uint8Array) || iv.byteLength !== 12) {
      throw new Error("Service token nonce source is invalid.");
    }
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          additionalData: asArrayBuffer(
            TEXT_ENCODER.encode("billy-service-api:s1"),
          ),
          iv: asArrayBuffer(iv),
          name: "AES-GCM",
          tagLength: 128,
        },
        await this.#aesKey,
        asArrayBuffer(plaintext),
      ),
    );
    return `s1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
  }

  async readOpaque<T>(
    token: unknown,
    expectedType: string,
    expectedSubject: string,
  ): Promise<T> {
    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
      throw new ServiceTokenError();
    }
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "s1") {
      throw new ServiceTokenError();
    }
    const iv = base64UrlDecode(parts[1]);
    const ciphertext = base64UrlDecode(parts[2]);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
      throw new ServiceTokenError();
    }

    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          additionalData: asArrayBuffer(
            TEXT_ENCODER.encode("billy-service-api:s1"),
          ),
          iv: asArrayBuffer(iv),
          name: "AES-GCM",
          tagLength: 128,
        },
        await this.#aesKey,
        asArrayBuffer(ciphertext),
      );
    } catch {
      throw new ServiceTokenError();
    }
    return parseEnvelope<T>(
      new Uint8Array(plaintext),
      expectedType,
      expectedSubject,
      this.#now().getTime(),
    );
  }

  async issueSigned<T>(
    type: string,
    subject: string,
    data: T,
    ttlMs: number,
  ): Promise<string> {
    const issuedAt = this.#now().getTime();
    const payload = encodeEnvelope(type, subject, data, issuedAt, ttlMs);
    const encodedPayload = base64UrlEncode(payload);
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await this.#hmacKey,
        asArrayBuffer(TEXT_ENCODER.encode(`q1.${encodedPayload}`)),
      ),
    );
    return `q1.${encodedPayload}.${base64UrlEncode(signature)}`;
  }

  async readSigned<T>(
    token: unknown,
    expectedType: string,
    expectedSubject: string,
  ): Promise<T> {
    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
      throw new ServiceTokenError();
    }
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "q1") {
      throw new ServiceTokenError();
    }
    const payload = base64UrlDecode(parts[1]);
    const signature = base64UrlDecode(parts[2]);
    const verified = await crypto.subtle.verify(
      "HMAC",
      await this.#hmacKey,
      asArrayBuffer(signature),
      asArrayBuffer(TEXT_ENCODER.encode(`q1.${parts[1]}`)),
    );
    if (!verified) throw new ServiceTokenError();
    return parseEnvelope<T>(
      payload,
      expectedType,
      expectedSubject,
      this.#now().getTime(),
    );
  }
}

export function createHmacHexDigester(
  secret: string,
): (value: string) => Promise<string> {
  const key = importHmacKey(validateSecret(secret));
  return async (value: string) => {
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await key,
        asArrayBuffer(TEXT_ENCODER.encode(value)),
      ),
    );
    return [...signature]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };
}
