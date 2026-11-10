import { splitFullName, validateFullName } from '@/features/auth/full-name';
describe('full name', () => {
  it('preserves all name parts and normalizes whitespace', () => {
    expect(splitFullName('  Ada   Nneka Okafor  ')).toEqual({
      fullName: 'Ada Nneka Okafor',
      firstName: 'Ada',
      lastName: 'Nneka Okafor',
    });
  });
  it('accepts a single name without inventing a surname', () => {
    expect(validateFullName('Wisdom')).toBe('');
    expect(splitFullName('Wisdom').lastName).toBe('');
  });
  it('rejects empty and overlong names before the profile request', () => {
    expect(validateFullName('  ')).toBeTruthy();
    expect(validateFullName('a'.repeat(81))).toBeTruthy();
  });
});
