const common = ['password', 'password1', '123456789', '1234567890', 'qwertyuiop', 'iloveyou12', 'kaamsetu123', 'welcome123'];
/** Returns a user-facing problem or null. Mirrors the Supabase Auth password requirements to configure. */
export function validatePassword(value: string): string | null {
  if (value.length < 10) return 'Use at least 10 characters.';
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) return 'Include upper case, lower case and a number.';
  if (common.some((c) => value.toLowerCase().includes(c))) return 'That password is too common. Choose something less guessable.';
  return null;
}
