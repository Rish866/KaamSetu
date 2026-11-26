import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { Card, Pill } from './ui';

type Metric<T> = { sample: number; shown: boolean } & T;
export type Scorecard = {
  company_id: string; window_days: number; active_jobs: number; new_employer: boolean;
  response: Metric<{ median_hours: number | null; within_7_days_pct: number | null }>;
  offers: Metric<{ withdrawn: number | null; honoured_pct: number | null }>;
  joining: Metric<{ joined_pct: number | null }>;
  retention: Metric<{ day_30_pct: number | null }>;
};

export async function loadScorecards(companyIds: string[]): Promise<Record<string, Scorecard>> {
  const ids = [...new Set(companyIds)];
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('company_scorecards', { p_companies: ids });
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as unknown as Scorecard[]).map((s) => [s.company_id, s]));
}

export function formatHours(h: number): string {
  if (h < 1) return 'under an hour';
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} days`;
}

/** One short line for job cards. */
export function scorecardLine(s?: Scorecard | null): string | null {
  if (!s) return null;
  if (s.new_employer) return 'New employer on KaamSetu: not enough hiring history yet';
  const parts = [];
  if (s.response.shown && s.response.median_hours !== null) parts.push(`usually responds in ${formatHours(s.response.median_hours)}`);
  if (s.offers.shown) parts.push(`${s.offers.honoured_pct}% of offers honoured`);
  if (s.joining.shown) parts.push(`${s.joining.joined_pct}% of hires joined`);
  return parts.length ? parts.join(' · ') : null;
}

function Row({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.label}>{label}</Text><Text style={styles.detail}>{detail}</Text></View><Text style={styles.value}>{value}</Text></View>;
}

/** Full card: every number comes from KaamSetu's own hiring record; small samples are shown as "not enough data". */
export function ScorecardCard({ s, own = false }: { s: Scorecard; own?: boolean }) {
  const nd = (n: number, need: number) => `Not enough data yet (${n} of ${need} needed)`;
  return <Card style={{ gap: 10 }}>
    <View style={styles.head}><Text accessibilityRole="header" style={styles.title}>{own ? 'Your public reliability record' : 'Employer reliability'}</Text>
      {s.new_employer && <Pill tone="saffron">New employer</Pill>}</View>
    <Text style={styles.detail}>Calculated by KaamSetu from the last {s.window_days} days of real hiring activity. Employers cannot edit these numbers.</Text>
    <Row label="Response time" value={s.response.shown && s.response.median_hours !== null ? formatHours(s.response.median_hours) : '–'}
      detail={s.response.shown ? `${s.response.within_7_days_pct}% of applicants heard back within 7 days (${s.response.sample} applications)` : nd(s.response.sample, 5)} />
    <Row label="Offers honoured" value={s.offers.shown ? `${s.offers.honoured_pct}%` : '–'}
      detail={s.offers.shown ? `${s.offers.withdrawn} of ${s.offers.sample} offers withdrawn by the employer` : nd(s.offers.sample, 3)} />
    <Row label="Hires who joined" value={s.joining.shown ? `${s.joining.joined_pct}%` : '–'}
      detail={s.joining.shown ? `Confirmed joinings vs. no-shows (${s.joining.sample})` : nd(s.joining.sample, 3)} />
    <Row label="Still working at day 30" value={s.retention.shown ? `${s.retention.day_30_pct}%` : '–'}
      detail={s.retention.shown ? `${s.retention.sample} confirmed outcomes` : nd(s.retention.sample, 3)} />
    <Text style={styles.detail}>{s.active_jobs} open job{s.active_jobs === 1 ? '' : 's'}. Joining and retention count only outcomes confirmed by both sides or decided by KaamSetu.</Text>
  </Card>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  title: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  detail: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
  value: { color: colors.tealDark, fontSize: 18, fontWeight: '900' },
});
