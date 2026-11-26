import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { friendlyError, labelize } from '../lib/format';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { Banner, ConfirmDialog, Field, Row, SectionHead, StateView, unwrap, useLoad } from './kit';
import { Card, Pill, PrimaryButton } from './ui';

export type FeeTerms = { enabled: boolean; amount_inr: number; milestone: 'joined_day_1' | 'retained_day_15' | 'retained_day_30' };
export type LedgerRow = { entry_id: string; company_name: string; application_id: string; job_title: string; candidate_name: string; amount_inr: number;
  fee_milestone: string; fee_milestone_label: string; status: string; created_at: string; payable_at: string | null; closed_at: string | null;
  payment_reference: string | null; history: { to: string; reason: string | null; at: string; automatic: boolean }[] };

export const milestoneLabels: Record<string, string> = { joined_day_1: 'joins (day 1)', retained_day_15: 'is still working at day 15', retained_day_30: 'is still working at day 30' };
export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
export const statusLabels: Record<string, string> = { pending_milestone: 'Waiting for milestone', payable: 'Payable', paid: 'Paid', waived: 'Waived', disputed: 'Disputed', void: 'No fee (hire did not happen)' };
const tone = (s: string) => (s === 'payable' ? 'saffron' : s === 'disputed' ? 'coral' : s === 'paid' ? 'teal' : 'neutral') as 'saffron' | 'coral' | 'teal' | 'neutral';

export function termsText(t?: FeeTerms | null): string {
  if (!t || !t.enabled || t.amount_inr <= 0) return 'Hiring on KaamSetu is free right now: no fee is charged for hires. Job posting is always free and candidates never pay.';
  return `${inr(t.amount_inr)} per hire, due only when the candidate ${milestoneLabels[t.milestone]} and both sides have confirmed it. Job posting is free and candidates never pay. The terms in force when a candidate accepts an offer apply to that hire.`;
}

export function LedgerEntry({ r, actions }: { r: LedgerRow; actions?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Card style={{ gap: 8 }}>
    <View style={styles.head}><View style={{ flex: 1 }}><Text style={styles.title}>{r.candidate_name} · {r.job_title}</Text>
      <Text style={styles.muted}>{r.company_name} · {inr(r.amount_inr)} when the hire is confirmed as {r.fee_milestone_label.toLowerCase()}</Text></View>
      <Pill tone={tone(r.status)}>{statusLabels[r.status] ?? labelize(r.status)}</Pill></View>
    {r.payment_reference && <Text style={styles.muted}>Payment reference: {r.payment_reference}</Text>}
    <Row>{actions}<PrimaryButton label={open ? 'Hide history' : 'History'} variant="ghost" onPress={() => setOpen(!open)} /></Row>
    {open && <View style={styles.hist}>{r.history.map((h, i) => <Text key={i} style={styles.muted}>{new Date(h.at).toLocaleString('en-IN')} · {statusLabels[h.to] ?? h.to}{h.automatic ? ' (automatic)' : ''}{h.reason ? ` · ${h.reason}` : ''}</Text>)}</View>}
  </Card>;
}

/** Employer dashboard section: current terms and this company's fee record. Only owners can dispute. */
export function CompanyLedger({ companyId, isOwner, terms }: { companyId: string; isOwner: boolean; terms?: FeeTerms | null }) {
  const q = useLoad(async () => (unwrap(await supabase.rpc('company_ledger', { p_company: companyId })) ?? []) as unknown as LedgerRow[], [companyId]);
  const [dispute, setDispute] = useState<LedgerRow | null>(null); const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const rows = q.data ?? [];
  const due = rows.filter((r) => r.status === 'payable').reduce((a, r) => a + r.amount_inr, 0);
  return <>
    <SectionHead title="Hiring fees" sub={termsText(terms)} />
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    {due > 0 && <Banner tone="warn">{inr(due)} payable. KaamSetu will contact the company owner with payment details. Dispute any fee that is not right.</Banner>}
    <StateView loading={q.loading} error={q.error} onRetry={q.reload} empty={rows.length === 0} emptyTitle="No hiring fees" emptyText="Fees appear here only for hires accepted while a fee is in force.">
      <View style={{ gap: 10 }}>{rows.map((r) => <LedgerEntry key={r.entry_id} r={r} actions={isOwner && r.status === 'payable' ? <PrimaryButton label="Dispute this fee" variant="secondary" onPress={() => setDispute(r)} /> : null} />)}</View>
    </StateView>
    <ConfirmDialog visible={!!dispute} title="Dispute this fee?" message="KaamSetu reviews it and decides. Explain what is wrong, for example the candidate did not actually stay." confirmLabel="Send dispute" requireReason minReason={10}
      onCancel={() => setDispute(null)} onConfirm={async (reason) => {
        const { error } = await supabase.rpc('dispute_ledger_entry', { p_entry: dispute!.entry_id, p_reason: reason }); if (error) throw error;
        setDispute(null); setMsg({ tone: 'success', text: 'Dispute sent. KaamSetu will review it.' }); await q.reload();
      }} />
  </>;
}

/** Admin: fee terms and the platform-wide ledger. */
export function AdminLedger({ tick }: { tick: number }) {
  const flags = useLoad(async () => (unwrap(await supabase.rpc('platform_flags')) as unknown as { hire_fee: FeeTerms }).hire_fee, [tick]);
  const [status, setStatus] = useState<string>('payable');
  const q = useLoad(async () => (unwrap(await supabase.rpc('admin_ledger', { p_status: status === 'all' ? null : status })) ?? []) as unknown as LedgerRow[], [status, tick]);
  const [edit, setEdit] = useState<FeeTerms | null>(null); const [amount, setAmount] = useState('');
  const [act, setAct] = useState<{ r: LedgerRow; action: 'mark_paid' | 'waive' | 'uphold' } | null>(null); const [ref, setRef] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const t = flags.data;
  return <>
    <SectionHead title="Hire fee terms" sub="Applied to hires accepted after the change. Every change needs a reason and is audited." />
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    <Card style={{ gap: 10 }}><Text style={styles.body}>{termsText(t)}</Text>
      {t && <PrimaryButton label="Change terms" variant="secondary" onPress={() => { setEdit(t); setAmount(String(t.amount_inr)); }} />}</Card>
    <SectionHead title="Hiring fee ledger" sub="No payments are taken through KaamSetu yet. Record a payment only after it has arrived, with the bank or UPI reference." />
    <Row>{['payable', 'disputed', 'pending_milestone', 'paid', 'waived', 'void', 'all'].map((s) => <PrimaryButton key={s} label={s === 'all' ? 'All' : statusLabels[s]} variant={status === s ? 'primary' : 'secondary'} onPress={() => setStatus(s)} />)}</Row>
    <StateView loading={q.loading} error={q.error} onRetry={q.reload} empty={(q.data ?? []).length === 0} emptyTitle="Nothing here">
      <View style={{ gap: 10 }}>{(q.data ?? []).map((r) => <LedgerEntry key={r.entry_id} r={r} actions={<>
        {r.status === 'payable' && <PrimaryButton label="Record payment" onPress={() => { setRef(''); setAct({ r, action: 'mark_paid' }); }} />}
        {r.status === 'disputed' && <PrimaryButton label="Fee stands" onPress={() => setAct({ r, action: 'uphold' })} />}
        {['pending_milestone', 'payable', 'disputed'].includes(r.status) && <PrimaryButton label="Waive" variant="secondary" onPress={() => setAct({ r, action: 'waive' })} />}</>} />)}</View>
    </StateView>
    <ConfirmDialog visible={!!edit} title="Change hire fee terms" confirmLabel="Save terms" requireReason minReason={10} onCancel={() => setEdit(null)}
      onConfirm={async (reason) => {
        const n = Number(amount.replace(/\D/g, '') || 0);
        const { error } = await supabase.rpc('admin_set_hire_fee', { p_enabled: edit!.enabled, p_amount_inr: n, p_milestone: edit!.milestone, p_reason: reason }); if (error) throw error;
        setEdit(null); setMsg({ tone: 'success', text: 'Terms saved. They apply to offers accepted from now on.' }); await flags.reload();
      }}>
      {edit && <>
        <Row><PrimaryButton label="Fees off" variant={edit.enabled ? 'secondary' : 'primary'} onPress={() => setEdit({ ...edit, enabled: false })} /><PrimaryButton label="Fees on" variant={edit.enabled ? 'primary' : 'secondary'} onPress={() => setEdit({ ...edit, enabled: true })} /></Row>
        <Field label="Fee per hire (₹)" value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Text style={styles.muted}>Due when the candidate:</Text>
        <Row>{(['joined_day_1', 'retained_day_15', 'retained_day_30'] as const).map((m) => <PrimaryButton key={m} label={milestoneLabels[m]} variant={edit.milestone === m ? 'primary' : 'secondary'} onPress={() => setEdit({ ...edit, milestone: m })} />)}</Row>
      </>}
    </ConfirmDialog>
    <ConfirmDialog visible={!!act} requireReason title={act?.action === 'mark_paid' ? 'Record payment' : act?.action === 'uphold' ? 'Keep this fee' : 'Waive this fee'}
      message={act ? `${act.r.company_name} · ${act.r.candidate_name} · ${inr(act.r.amount_inr)}` : undefined} confirmLabel="Save" onCancel={() => setAct(null)}
      onConfirm={async (reason) => {
        const { error } = await supabase.rpc('admin_ledger_action', { p_entry: act!.r.entry_id, p_action: act!.action, p_reason: reason, p_reference: act!.action === 'mark_paid' ? ref.trim() : null });
        if (error) throw { message: friendlyError(error), code: error.code };
        setAct(null); setMsg({ tone: 'success', text: 'Saved and recorded in the audit log.' }); await q.reload();
      }}>
      {act?.action === 'mark_paid' && <Field label="Payment reference (bank or UPI transaction id)" value={ref} onChangeText={setRef} autoCapitalize="characters" />}
    </ConfirmDialog>
  </>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  title: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  body: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
  hist: { gap: 4, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
});
