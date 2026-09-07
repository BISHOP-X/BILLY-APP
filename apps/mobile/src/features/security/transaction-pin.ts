export const TRANSACTION_PIN_LENGTH = 4;

export const LEGACY_TRANSACTION_PIN_LENGTH = 6;

export const TRANSACTION_PIN_INPUT_MAX_LENGTH = LEGACY_TRANSACTION_PIN_LENGTH;

export function normalizeTransactionPin(value: string) {
  return value.replace(/\D/g, '').slice(0, TRANSACTION_PIN_INPUT_MAX_LENGTH);
}

export function isCompleteTransactionPin(value: string) {
  return (
    value.length === TRANSACTION_PIN_LENGTH ||
    value.length === LEGACY_TRANSACTION_PIN_LENGTH
  );
}

export function isCompleteNewTransactionPin(value: string) {
  return value.length === TRANSACTION_PIN_LENGTH;
}
