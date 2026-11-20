import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeSubject, providerFromEnv, renderEmail, safeEqual } from '../../supabase/functions/_shared/email-templates.ts';
import { scannerFromEnv } from '../../supabase/functions/_shared/scanner.ts';

const site = 'https://www.getkaamsetu.in';
test('optional emails carry an unsubscribe link and one-click header; essential and security emails do not', () => {
  const o = renderEmail({ kind: 'application.viewed', category: 'optional', subject: 'Your application was viewed', siteUrl: site, unsubscribeUrl: 'https://x/unsubscribe?token=t' });
  assert.match(o.html, /Stop optional emails/); assert.equal(o.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  for (const category of ['essential', 'security'] as const) {
    const e = renderEmail({ kind: 'interview.proposed', category, subject: 'Interview proposed', siteUrl: site, unsubscribeUrl: 'https://x/u' });
    assert.doesNotMatch(e.html, /Stop optional emails/); assert.deepEqual(e.headers, {});
  }
});
test('bodies never include application details and escape HTML', () => {
  const e = renderEmail({ kind: 'application.offer', category: 'essential', subject: 'You have an <offer>', siteUrl: site });
  assert.match(e.html, /&lt;offer&gt;/); assert.match(e.text, /never put application details in email/);
  assert.match(renderEmail({ kind: 'security.password_changed', category: 'security', subject: 'Your password was changed', siteUrl: site }).text, /reset your password now/);
});
test('subjects containing emails, phone numbers or salaries are refused', () => {
  for (const s of ['Hi asha@example.com', 'Call +91 98200 12345', 'Offer ₹7 LPA', 'x'.repeat(121)]) assert.throws(() => assertSafeSubject(s), /unsafe_subject/, s);
  assert.equal(assertSafeSubject('Interview proposed'), 'Interview proposed');
});
test('no provider configured means no provider (messages stay queued)', () => {
  assert.equal(providerFromEnv(() => undefined), null);
  assert.equal(providerFromEnv((k) => ({ EMAIL_PROVIDER: 'resend' } as Record<string, string>)[k]), null, 'key and sender are required');
  assert.throws(() => providerFromEnv((k) => ({ EMAIL_PROVIDER: 'carrier-pigeon', EMAIL_API_KEY: 'k', EMAIL_FROM: 'f' } as Record<string, string>)[k]), /unknown_email_provider/);
});
test('provider adapters send the documented request shape and surface HTTP failures (fake fetch; not verified against live providers)', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (status: number) => (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status }); }) as unknown as typeof fetch;
  const env = (p: string) => (k: string) => ({ EMAIL_PROVIDER: p, EMAIL_API_KEY: 'test-key', EMAIL_FROM: 'KaamSetu <no-reply@getkaamsetu.in>' } as Record<string, string>)[k];
  const email = renderEmail({ kind: 'x', category: 'essential', subject: 'Update', siteUrl: site });
  await providerFromEnv(env('resend'), fake(200))!.send('a@b.test', email);
  assert.equal(calls[0].url, 'https://api.resend.com/emails'); assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-key');
  await providerFromEnv(env('postmark'), fake(200))!.send('a@b.test', email);
  assert.equal(calls[1].url, 'https://api.postmarkapp.com/email'); assert.equal(JSON.parse(String(calls[1].init.body)).To, 'a@b.test');
  await assert.rejects(providerFromEnv(env('resend'), fake(429))!.send('a@b.test', email), /provider_http_429/);
});
test('scanner adapter maps clamav-rest responses (fake fetch; not verified against a running ClamAV)', async () => {
  assert.equal(scannerFromEnv(() => undefined), null);
  const env = (k: string) => ({ SCANNER: 'clamav-rest', SCANNER_URL: 'http://scanner.local' } as Record<string, string>)[k];
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.equal((await scannerFromEnv(env, reply(200, [{ Status: 'OK' }]))!.scan(new Uint8Array([1]), 'r.pdf')).verdict, 'clean');
  assert.equal((await scannerFromEnv(env, reply(406, [{ Status: 'FOUND' }]))!.scan(new Uint8Array([1]), 'r.pdf')).verdict, 'infected');
  assert.equal((await scannerFromEnv(env, reply(200, [{ Status: 'FOUND', Description: 'Eicar' }]))!.scan(new Uint8Array([1]), 'r.pdf')).verdict, 'infected');
  assert.equal((await scannerFromEnv(env, reply(500, {}))!.scan(new Uint8Array([1]), 'r.pdf')).verdict, 'error');
});
test('worker secret comparison', () => {
  assert.equal(safeEqual('abc', 'abc'), true); assert.equal(safeEqual('abc', 'abd'), false); assert.equal(safeEqual('', ''), false); assert.equal(safeEqual('a', 'ab'), false);
});
