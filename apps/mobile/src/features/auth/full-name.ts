/** Keep every part of the entered name; the split is for legacy profile fields only. */
export function splitFullName(value: string) {
  const fullName = value.trim().replace(/\s+/g, ' ');
  const [firstName = '', ...rest] = fullName.split(' ');
  return { fullName, firstName, lastName: rest.join(' ') };
}

export function validateFullName(value: string) {
  const { fullName, firstName, lastName } = splitFullName(value);
  if (!fullName) return 'Enter your full name.';
  if (fullName.length > 120 || firstName.length > 80 || lastName.length > 80) {
    return 'Please shorten your name to fit your profile.';
  }
  return '';
}
