// Safe, provider-independent email rendering. Bodies never contain names, contact details, salaries or job content:
// they tell the user something happened and link to the app.
export type Category = 'security' | 'essential' | 'optional';
export type Rendered = { subject: string; html: string; text: string; headers: Record<string, string> };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const lines: Record<string, string> = {
  'security.password_changed': 'The password for your KaamSetu account was changed. If you did not do this, reset your password now and contact support.',
  'security.contact_changed': 'The email address or mobile number on your KaamSetu account was changed. If you did not do this, contact support now.',
  'privacy.deletion_completed': 'Your request to delete your KaamSetu account has been completed. Your profile, skills and resume have been removed.',
};
const generic = 'There is an update on your KaamSetu account. Sign in to see the details. For your privacy we never put application details in email.';

/** Subjects come from notification titles, which are fixed strings without personal data; this also enforces it. */
export function assertSafeSubject(subject: string): string {
  if (subject.length > 120 || /@|\+?\d[\d\s-]{7,}|₹/.test(subject)) throw new Error('unsafe_subject');
  return subject;
}

export function renderEmail(input: { kind: string; category: Category; subject: string; siteUrl: string; unsubscribeUrl?: string }): Rendered {
  const subject = assertSafeSubject(input.subject);
  const line = lines[input.kind] ?? generic;
  const why = input.category === 'optional'
    ? 'You receive this optional update because email updates are on in your KaamSetu settings.'
    : input.category === 'security' ? 'This is a security message and is always sent.' : 'This message is about your account or an application and is always sent.';
  const unsub = input.category === 'optional' && input.unsubscribeUrl;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#11152A;max-width:560px">`
    + `<h2 style="font-size:18px">${esc(subject)}</h2><p>${esc(line)}</p>`
    + (input.kind === 'privacy.deletion_completed' ? '' : `<p><a href="${esc(input.siteUrl)}">Open KaamSetu</a></p>`)
    + `<p style="color:#667085;font-size:12px">${esc(why)} KaamSetu is operated by Aarvya Global Ventures LLP.`
    + (unsub ? ` <a href="${esc(input.unsubscribeUrl as string)}">Stop optional emails</a>.` : '') + `</p></body></html>`;
  const text = `${subject}\n\n${line}\n\n${input.kind === 'privacy.deletion_completed' ? '' : `${input.siteUrl}\n\n`}${why}${unsub ? `\nStop optional emails: ${input.unsubscribeUrl}` : ''}`;
  const headers: Record<string, string> = unsub ? { 'List-Unsubscribe': `<${input.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {};
  return { subject, html, text, headers };
}

export type Provider = { name: string; send: (to: string, email: Rendered) => Promise<void> };
type Env = (k: string) => string | undefined;

/** Returns the configured provider, or null when none is configured (messages then stay queued, never "sent"). */
export function providerFromEnv(env: Env, fetchImpl: typeof fetch = fetch): Provider | null {
  const name = env('EMAIL_PROVIDER'); const key = env('EMAIL_API_KEY'); const from = env('EMAIL_FROM');
  if (!name || !key || !from) return null;
  const post = async (url: string, headers: Record<string, string>, body: unknown) => {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`provider_http_${res.status}`);
  };
  if (name === 'resend') return { name, send: (to, e) => post('https://api.resend.com/emails', { Authorization: `Bearer ${key}` }, { from, to: [to], subject: e.subject, html: e.html, text: e.text, headers: e.headers }) };
  if (name === 'postmark') return { name, send: (to, e) => post('https://api.postmarkapp.com/email', { 'X-Postmark-Server-Token': key, Accept: 'application/json' },
    { From: from, To: to, Subject: e.subject, HtmlBody: e.html, TextBody: e.text, MessageStream: 'outbound', Headers: Object.entries(e.headers).map(([Name, Value]) => ({ Name, Value })) }) };
  // Generic HTTPS relay (any provider or an internal relay): POSTs the rendered message as JSON with a bearer key.
  if (name === 'webhook') {
    const url = env('EMAIL_WEBHOOK_URL'); if (!url) return null;
    return { name, send: (to, e) => post(url, { Authorization: `Bearer ${key}` }, { from, to, subject: e.subject, html: e.html, text: e.text, headers: e.headers }) };
  }
  throw new Error(`unknown_email_provider_${name}`);
}

/** Constant-time comparison for worker shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
