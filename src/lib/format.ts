// Pure helpers (no React Native imports) so they can be unit-tested with plain Node.

export type SalaryPeriod = 'monthly' | 'annual';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** "₹5.4–7.2 LPA" for annual figures, "₹30,000–45,000 / month" for monthly. */
export function formatSalaryRange(min: number, max: number, period: SalaryPeriod): string {
  if (period === 'monthly') return `${inr(min)}–${Math.round(max).toLocaleString('en-IN')} / month`;
  const lpa = (v: number) => (v / 100000).toFixed(1).replace(/\.0$/, '');
  return `₹${lpa(min)}–${lpa(max)} LPA`;
}

/** Single amount: "₹6 LPA" or "₹40,000 / month". */
export function formatSalaryAmount(value: number, period: SalaryPeriod): string {
  return period === 'monthly' ? `${inr(value)} / month` : `₹${(value / 100000).toFixed(1).replace(/\.0$/, '')} LPA`;
}

export function formatExperience(months: number | null | undefined): string {
  if (months === null || months === undefined) return 'Not specified';
  if (months < 12) return months === 0 ? 'Fresher' : `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12); const rest = months % 12;
  return rest === 0 ? `${years} year${years === 1 ? '' : 's'}` : `${years} yr ${rest} mo`;
}

export function formatLocation(city?: string | null, locality?: string | null, workMode?: string | null): string {
  if (workMode === 'remote') return 'Remote';
  return [locality, city].filter(Boolean).join(', ') || 'Location not specified';
}

export function labelize(value: string | null | undefined): string {
  if (!value) return '';
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24); if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-IN');
}

/** Parses "2026-12-01 14:30" (local time) into an ISO string, or null when invalid. */
export function parseLocalDateTime(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59) return null;
  return date.toISOString();
}

export const stageLabels: Record<string, string> = {
  applied: 'Applied', viewed: 'Viewed', shortlisted: 'Shortlisted', interview: 'Interview',
  offer: 'Offer', hired: 'Hired', rejected: 'Not selected', withdrawn: 'Withdrawn',
};

/** Maps database and network errors to messages that are safe and understandable. */
export function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return '';
  const message = error.message ?? '';
  if (/failed to fetch|network request failed|networkerror|load failed/i.test(message)) return 'You appear to be offline. Check your connection and try again.';
  if (error.code === '42501' && !/^[A-Z]/.test(message)) return 'You do not have permission to do that.';
  if (/permission denied|row-level security/i.test(message)) return 'You do not have permission to do that.';
  if (error.code === '23505' && /duplicate key/i.test(message)) return 'That already exists.';
  if (/JWT|session/i.test(message)) return 'Your session has expired. Please sign in again.';
  // Messages raised by our own database functions are written for users.
  if (error.code && /^(P0002|55000|22023|23505|23514|42501|28000|P0001)$/.test(error.code)) return message;
  return 'Something went wrong. Please try again.';
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '–' : `${Math.round(value)}%`;
}

export function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return globalThis.crypto.subtle.digest('SHA-256', buffer).then((d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''));
}
