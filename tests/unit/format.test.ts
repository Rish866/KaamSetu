import { validatePassword } from '../../src/lib/password.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSalaryAmount, formatSalaryRange, formatExperience, formatLocation, parseLocalDateTime, timeAgo, friendlyError, labelize, percent } from '../../src/lib/format.ts';

test('salary ranges are always visible and correctly formatted', () => {
  assert.equal(formatSalaryRange(540000, 720000, 'annual'), '₹5.4–7.2 LPA');
  assert.equal(formatSalaryRange(500000, 700000, 'annual'), '₹5–7 LPA');
  assert.equal(formatSalaryRange(30000, 45000, 'monthly'), '₹30,000–45,000 / month');
});
test('single salary amount', () => { assert.equal(formatSalaryAmount(600000, 'annual'), '₹6 LPA'); assert.equal(formatSalaryAmount(40000, 'monthly'), '₹40,000 / month'); });
test('experience formatting', () => {
  assert.equal(formatExperience(0), 'Fresher'); assert.equal(formatExperience(1), '1 month'); assert.equal(formatExperience(24), '2 years');
  assert.equal(formatExperience(30), '2 yr 6 mo'); assert.equal(formatExperience(null), 'Not specified');
});
test('location formatting', () => {
  assert.equal(formatLocation('Mumbai', 'Andheri'), 'Andheri, Mumbai'); assert.equal(formatLocation('Pune', null, 'remote'), 'Remote'); assert.equal(formatLocation(null, null), 'Location not specified');
});
test('local date-time parsing rejects impossible dates', () => {
  assert.ok(parseLocalDateTime('2026-12-01 14:30')); assert.equal(parseLocalDateTime('2026-02-30 10:00'), null);
  assert.equal(parseLocalDateTime('tomorrow'), null); assert.equal(parseLocalDateTime('2026-12-01 25:00'), null);
  assert.equal(new Date(parseLocalDateTime('2026-12-01 14:30')!).getHours(), 14);
});
test('relative time', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  assert.equal(timeAgo('2026-11-19T11:59:30Z', now), 'just now'); assert.equal(timeAgo('2026-11-19T09:00:00Z', now), '3 hours ago'); assert.equal(timeAgo('2026-11-17T12:00:00Z', now), '2 days ago');
});
test('errors never leak internals but keep our own messages', () => {
  assert.equal(friendlyError({ message: 'Failed to fetch' }), 'You appear to be offline. Check your connection and try again.');
  assert.equal(friendlyError({ message: 'permission denied for table x', code: '42501' }), 'You do not have permission to do that.');
  assert.equal(friendlyError({ message: 'You have already applied to this job', code: '23505' }), 'You have already applied to this job');
  assert.equal(friendlyError({ message: 'relation "x" does not exist', code: '42P01' }), 'Something went wrong. Please try again.');
  assert.equal(friendlyError(null), '');
});
test('small helpers', () => { assert.equal(labelize('full_time'), 'Full time'); assert.equal(percent(86.4), '86%'); assert.equal(percent(null), '–'); });

test('password policy', () => {
  assert.ok(validatePassword('short1A')); assert.ok(validatePassword('alllowercase123')); assert.ok(validatePassword('Password1234'));
  assert.equal(validatePassword('Maroon-Tiger-42x'), null);
});
