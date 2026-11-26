import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { friendlyError } from '../lib/format';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { Banner, ConfirmDialog, Field, Row } from './kit';
import { Pill, PrimaryButton } from './ui';

export type Milestone = { id: string; kind: string; label: string; status: 'pending' | 'confirmed' | 'disputed' | 'rejected'; occurred_on: string;
  reported_role: 'employer' | 'candidate'; confirmed_via: string | null; note: string | null; dispute_reason: string | null; resolution_reason: string | null };
export type HiringStatus = { application_id: string; joining_date: string | null; milestones: Milestone[] };

/** Loads joining dates and milestones for many applications in one call. */
export async function loadHiring(ids: string[]): Promise<Record<string, HiringStatus>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('hiring_status', { p_applications: ids });
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as unknown as HiringStatus[]).map((h) => [h.application_id, h]));
}

const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const daysSince = (d: string) => Math.floor((Date.now() - Date.parse(`${d}T00:00:00`)) / 86400e3);
const statusText = (m: Milestone, side: string) => m.status === 'confirmed'
  ? (m.confirmed_via === 'auto' ? 'Confirmed (no reply in 7 days)' : m.confirmed_via === 'admin' ? 'Confirmed by KaamSetu' : 'Confirmed')
  : m.status === 'pending' ? (m.reported_role === side ? 'Waiting for the other side' : 'Please confirm') : m.status === 'disputed' ? 'Disputed: KaamSetu will decide' : 'Not accepted by KaamSetu';
type Dialog = { kind: 'decline' | 'withdraw' | 'date' | 'report' | 'dispute'; milestone?: string; report?: string; title: string } | null;

export function HiringMilestones({ applicationId, side, stage, status, onChanged }: {
  applicationId: string; side: 'candidate' | 'employer'; stage: string; status?: HiringStatus; onChanged: () => Promise<void> | void }) {
  const [dlg, setDlg] = useState<Dialog>(null); const [date, setDate] = useState(today()); const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const ms = status?.milestones ?? []; const active = (k: string) => ms.find((m) => m.kind === k && m.status !== 'rejected');
  const joined = active('joined_day_1'); const noShow = active('candidate_no_show'); const left = active('left_before_day_30');
  const offerOpen = stage === 'offer' && Boolean(active('offer_issued'));
  if (ms.length === 0 && !offerOpen && stage !== 'hired') return null;

  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    const { error } = await supabase.rpc(fn, args); if (error) throw error;
    setDlg(null); setMsg({ tone: 'success', text: ok }); await onChanged();
  }
  const open = (d: NonNullable<Dialog>) => { setDate(today()); setNote(''); setMsg(null); setDlg(d); };
  const report = (kind: string, title: string) => open({ kind: 'report', report: kind, title });

  return <View style={styles.box}>
    <Text style={styles.head}>Offer and joining</Text>
    {status?.joining_date && <Text style={styles.muted}>Agreed joining date: {new Date(`${status.joining_date}T00:00:00`).toLocaleDateString('en-IN')}</Text>}
    {ms.map((m) => <View key={m.id} style={styles.item}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.label}>{m.label} · {new Date(`${m.occurred_on}T00:00:00`).toLocaleDateString('en-IN')} · reported by {m.reported_role === side ? 'you' : m.reported_role === 'employer' ? 'the employer' : 'the candidate'}</Text>
        {m.note && !(side === 'candidate' && m.kind === 'offer_issued') && <Text style={styles.muted}>{m.note}</Text>}{/* candidates already see the offer text in their timeline */}
        {m.dispute_reason && <Text style={styles.muted}>Dispute: {m.dispute_reason}</Text>}
        {m.resolution_reason && <Text style={styles.muted}>KaamSetu decision: {m.resolution_reason}</Text>}
      </View>
      <Pill tone={m.status === 'confirmed' ? 'teal' : m.status === 'rejected' ? 'coral' : m.status === 'disputed' ? 'coral' : 'saffron'}>{statusText(m, side)}</Pill>
      {m.status === 'pending' && m.reported_role !== side && <Row>
        <PrimaryButton label="Confirm" icon="checkmark" onPress={() => call('confirm_hiring_milestone', { p_milestone: m.id }, `Confirmed: ${m.label}.`).catch((e) => setMsg({ tone: 'error', text: friendlyError(e) }))} />
        <PrimaryButton label="This is not right" variant="secondary" onPress={() => open({ kind: 'dispute', milestone: m.id, title: `Dispute: ${m.label}` })} /></Row>}
    </View>)}
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    <Row>
      {side === 'candidate' && offerOpen && <>
        <PrimaryButton label="Accept offer" icon="checkmark-circle-outline" onPress={() => call('respond_to_offer', { p_application: applicationId, p_accept: true }, 'Offer accepted. Congratulations!').catch((e) => setMsg({ tone: 'error', text: friendlyError(e) }))} />
        <PrimaryButton label="Decline offer" variant="secondary" onPress={() => open({ kind: 'decline', title: 'Decline this offer?' })} /></>}
      {side === 'employer' && ['offer', 'hired'].includes(stage) && !joined && !noShow && <>
        <PrimaryButton label={status?.joining_date ? 'Change joining date' : 'Set joining date'} variant="secondary" icon="calendar-outline" onPress={() => open({ kind: 'date', title: 'Agreed joining date' })} />
        <PrimaryButton label="Withdraw offer" variant="ghost" onPress={() => open({ kind: 'withdraw', title: 'Withdraw this offer?' })} /></>}
      {stage === 'hired' && !joined && !noShow && <PrimaryButton label={side === 'candidate' ? 'I joined' : 'Candidate joined'} icon="briefcase-outline" onPress={() => report('joined_day_1', 'Record the joining day')} />}
      {side === 'employer' && stage === 'hired' && !joined && !noShow && <PrimaryButton label="Did not join" variant="secondary" onPress={() => report('candidate_no_show', 'Record that the candidate did not join')} />}
      {stage === 'hired' && joined && !left && daysSince(joined.occurred_on) >= 15 && !active('retained_day_15') && <PrimaryButton label="Still working at day 15" variant="secondary" onPress={() => call('report_hiring_milestone', { p_application: applicationId, p_kind: 'retained_day_15' }, 'Recorded. The other side will be asked to confirm.').catch((e) => setMsg({ tone: 'error', text: friendlyError(e) }))} />}
      {stage === 'hired' && joined && !left && daysSince(joined.occurred_on) >= 30 && !active('retained_day_30') && <PrimaryButton label="Still working at day 30" variant="secondary" onPress={() => call('report_hiring_milestone', { p_application: applicationId, p_kind: 'retained_day_30' }, 'Recorded. The other side will be asked to confirm.').catch((e) => setMsg({ tone: 'error', text: friendlyError(e) }))} />}
      {stage === 'hired' && joined && !left && !active('retained_day_30') && <PrimaryButton label="Left before day 30" variant="ghost" onPress={() => report('left_before_day_30', 'Record leaving before day 30')} />}
    </Row>
    {stage === 'hired' && (joined || noShow) && <Text style={styles.small}>Each report is confirmed by the other side. If nobody replies within 7 days it is confirmed automatically; disagreements are decided by KaamSetu.</Text>}

    <ConfirmDialog visible={dlg?.kind === 'decline'} title={dlg?.title ?? ''} message="The employer will see your reason if you give one. The application ends." confirmLabel="Decline offer" destructive onCancel={() => setDlg(null)}
      onConfirm={() => call('respond_to_offer', { p_application: applicationId, p_accept: false, p_reason: note.trim() || null }, 'Offer declined.')}>
      <Field label="Reason (optional)" value={note} onChangeText={setNote} maxLength={500} /></ConfirmDialog>
    <ConfirmDialog visible={dlg?.kind === 'withdraw'} title={dlg?.title ?? ''} message="The candidate sees your reason. This cannot be undone and counts in your public reliability record." confirmLabel="Withdraw offer" destructive requireReason onCancel={() => setDlg(null)}
      onConfirm={(reason) => call('withdraw_offer', { p_application: applicationId, p_reason: reason }, 'Offer withdrawn.')} />
    <ConfirmDialog visible={dlg?.kind === 'dispute'} title={dlg?.title ?? ''} message="KaamSetu will review it with both sides. Explain what actually happened." confirmLabel="Send dispute" requireReason onCancel={() => setDlg(null)}
      onConfirm={(reason) => call('dispute_hiring_milestone', { p_milestone: dlg!.milestone, p_reason: reason }, 'Dispute sent to KaamSetu.')} />
    <ConfirmDialog visible={dlg?.kind === 'date' || dlg?.kind === 'report'} title={dlg?.title ?? ''} confirmLabel="Save" onCancel={() => setDlg(null)}
      message={dlg?.kind === 'report' ? 'The other side will be asked to confirm.' : 'The candidate is notified.'}
      onConfirm={async () => {
        if (!isDate(date)) throw { message: 'Enter the date as YYYY-MM-DD, for example 2026-12-01.', code: '22023' };
        if (dlg?.kind === 'date') return call('set_joining_date', { p_application: applicationId, p_date: date }, 'Joining date saved.');
        return call('report_hiring_milestone', { p_application: applicationId, p_kind: dlg!.report, p_on: date, p_note: note.trim() || null }, 'Recorded. The other side will be asked to confirm.');
      }}>
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-12-01" autoCapitalize="none" />
      {dlg?.kind === 'report' && <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} />}
    </ConfirmDialog>
  </View>;
}
const styles = StyleSheet.create({
  box: { gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  head: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  item: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  muted: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
  small: { color: colors.inkSoft, fontSize: 12 },
});
