import {
  isCompleteNewTransactionPin,
  isCompleteTransactionPin,
  normalizeTransactionPin,
  TRANSACTION_PIN_LENGTH,
} from '@/features/security/transaction-pin';

describe('transaction PIN rules', () => {
  it('uses four digits for newly created PINs', () => {
    expect(TRANSACTION_PIN_LENGTH).toBe(4);
    expect(isCompleteNewTransactionPin('4826')).toBe(true);
    expect(isCompleteNewTransactionPin('48261')).toBe(false);
  });

  it('temporarily accepts existing six-digit tester PINs for authorization', () => {
    expect(isCompleteTransactionPin('4826')).toBe(true);
    expect(isCompleteTransactionPin('928375')).toBe(true);
    expect(isCompleteTransactionPin('48261')).toBe(false);
  });

  it('keeps only numeric PIN input within the compatibility maximum', () => {
    expect(normalizeTransactionPin(' 48a2-619 ')).toBe('482619');
    expect(normalizeTransactionPin('123456789')).toBe('123456');
  });
});
