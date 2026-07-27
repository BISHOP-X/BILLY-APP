const ENCODER = new TextEncoder();
const DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_PLAINTEXT_BYTES = 24 * 1024;
const MAX_CIPHERTEXT_LENGTH = 48 * 1024;

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Payload is invalid.");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

async function keyFromSecret(secret: string): Promise<CryptoKey> {
  const bytes = ENCODER.encode(secret);
  if (bytes.byteLength < 32 || bytes.byteLength > 4096) {
    throw new Error(
      "PRESTMIT_CARD_DATA_SECRET must contain 32 to 4096 UTF-8 bytes.",
    );
  }
  const material = await crypto.subtle.digest(
    "SHA-256",
    arrayBuffer(
      ENCODER.encode(`billy-prestmit-fulfilment:${secret}`),
    ),
  );
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

/**
 * Long-lived AES-GCM protection for card fulfilment stored in Billy's private
 * schema. Unlike quote tokens, encrypted fulfilment intentionally has no
 * client-controlled expiry and is never returned without fresh PIN approval.
 */
export class SecretPayloadCipher {
  readonly #key: Promise<CryptoKey>;

  constructor(secret: string) {
    this.#key = keyFromSecret(secret);
  }

  async encrypt(value: unknown): Promise<string> {
    const plaintext = ENCODER.encode(JSON.stringify(value));
    if (
      plaintext.byteLength < 2 ||
      plaintext.byteLength > MAX_PLAINTEXT_BYTES
    ) {
      throw new Error("Fulfilment payload size is invalid.");
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          additionalData: arrayBuffer(ENCODER.encode("billy-prestmit:v1")),
          iv: arrayBuffer(iv),
          name: "AES-GCM",
          tagLength: 128,
        },
        await this.#key,
        arrayBuffer(plaintext),
      ),
    );
    return `p1.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
  }

  async decrypt<T>(value: string): Promise<T> {
    if (!value || value.length > MAX_CIPHERTEXT_LENGTH) {
      throw new Error("Fulfilment payload is invalid.");
    }
    const parts = value.split(".");
    if (parts.length !== 3 || parts[0] !== "p1") {
      throw new Error("Fulfilment payload is invalid.");
    }
    const iv = decodeBase64Url(parts[1]);
    const ciphertext = decodeBase64Url(parts[2]);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
      throw new Error("Fulfilment payload is invalid.");
    }
    const plaintext = await crypto.subtle.decrypt(
      {
        additionalData: arrayBuffer(ENCODER.encode("billy-prestmit:v1")),
        iv: arrayBuffer(iv),
        name: "AES-GCM",
        tagLength: 128,
      },
      await this.#key,
      arrayBuffer(ciphertext),
    );
    return JSON.parse(DECODER.decode(plaintext)) as T;
  }
}
