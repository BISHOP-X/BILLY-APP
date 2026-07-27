import * as Crypto from 'expo-crypto';

export function createBillyOperationKey(prefix: string) {
  const normalizedPrefix = prefix.replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
  return `${normalizedPrefix}-${Crypto.randomUUID()}`;
}

export type KycOperationIdentity = {
  fingerprint: string;
  idempotencyKey: string;
};

export async function resolveKycOperationIdentity(
  input: {
    method: string;
    number: string;
  },
  salt: string,
  previous: KycOperationIdentity | null,
) {
  const fingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${input.method}:${input.number}`,
  );

  if (previous?.fingerprint === fingerprint) return previous;

  return {
    fingerprint,
    idempotencyKey: createBillyOperationKey('kyc'),
  } satisfies KycOperationIdentity;
}
