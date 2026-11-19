import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../../components/AppShell';
import { Banner, ConfirmDialog, Field, Row, SectionHead, StateView, unwrap, useLoad } from '../../components/kit';
import { Card, Pill, PrimaryButton } from '../../components/ui';
import { formatSalaryRange, friendlyError, labelize, stageLabels, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';

type App = { id: string; job_id: string; title: string; company: string; stage: string; applied_at: string; updated_at: string; score: number | null;
  timeline: { stage: string; at: string; reason: string | null; details: string | null }[];
  interview: { id: string; proposed_at: string; mode: string; details: string | null; status: string } | null };
type Invite = { id: string; job_id: string; title: string; company: string; message: string | null; status: string; expires_at: string; salary_min: number; salary_max: number; salary_period: 'monthly' | 'annual' };
const tone = (s: string) => (s === 'rejected' || s === 'withdrawn' ? 'coral' : s === 'offer' || s === 'hired' ? 'saffron' : 'teal') as 'coral' | 'saffron' | 'teal';

export default function Applications() {
  const apps = useLoad(async () => (unwrap(await supabase.rpc('my_applications')) ?? []) as unknown as App[], []);
  const invites = useLoad(async () => ((unwrap(await supabase.rpc('my_invitations')) ?? []) as unknown as Invite[]), []);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [withdraw, setWithdraw] = useState<App | null>(null);
  const [resched, setResched] = useState<App | null>(null);
  const [declineInvite, setDeclineInvite] = useState<Invite | null>(null);
  const [note, setNote] = useState('');

  async function run(fn: () => PromiseLike<{ error: { message?: string; code?: string } | null }>, ok: string) {
    const { error } = await fn();
    if (error) return setMsg({ tone: 'error', text: friendlyError(error) });
    setMsg({ tone: 'success', text: ok }); await Promise.all([apps.reload(), invites.reload()]);
  }
  const pending = (invites.data ?? []).filter((i) => i.status === 'pending');

  return <AppShell role="Candidate" title="Applications" subtitle="Every update from employers appears here">
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    {pending.length > 0 && <><SectionHead title="Employer invitations" sub="Accepting sends your application. Your email and phone stay private." />
      {pending.map((i) => <Card key={i.id} style={{ gap: 10 }}><Text style={styles.title}>{i.title}</Text><Text style={styles.muted}>{i.company} · {formatSalaryRange(i.salary_min, i.salary_max, i.salary_period)} · expires {new Date(i.expires_at).toLocaleDateString('en-IN')}</Text>{i.message && <Text style={styles.body}>“{i.message}”</Text>}
        <Row><PrimaryButton label="Accept and apply" icon="checkmark" onPress={() => run(() => supabase.rpc('respond_to_invitation', { p_invitation: i.id, p_accept: true }), 'Application sent.')} /><PrimaryButton label="Decline" variant="secondary" onPress={() => setDeclineInvite(i)} /><PrimaryButton label="View job" variant="ghost" onPress={() => router.push(`/candidate/job/${i.job_id}`)} /></Row></Card>)}</>}
    <SectionHead title="Your applications" />
    <StateView loading={apps.loading} error={apps.error} onRetry={apps.reload} empty={(apps.data ?? []).length === 0} emptyTitle="You have not applied yet" emptyText="Find a job and apply with your profile. Each employer response will show here.">
      <View style={{ gap: 14 }}>{(apps.data ?? []).map((a) => <Card key={a.id} style={{ gap: 12 }}>
        <View style={styles.head}><View style={{ flex: 1 }}><Text style={styles.title}>{a.title}</Text><Text style={styles.muted}>{a.company} · applied {timeAgo(a.applied_at)}{a.score !== null ? ` · ${a.score}% match` : ''}</Text></View><Pill tone={tone(a.stage)}>{stageLabels[a.stage] ?? labelize(a.stage)}</Pill></View>
        <View style={styles.timeline}>{a.timeline.map((t, i) => <View key={i} style={styles.tl}><View style={styles.dot} /><View style={{ flex: 1 }}><Text style={styles.tlTitle}>{stageLabels[t.stage] ?? t.stage} · {new Date(t.at).toLocaleString('en-IN')}</Text>{t.reason && <Text style={styles.muted}>Reason: {t.reason}</Text>}{t.details && <Text style={styles.muted}>{t.details}</Text>}</View></View>)}</View>
        {a.interview && ['proposed', 'confirmed', 'reschedule_requested'].includes(a.interview.status) && <Card style={styles.interview}>
          <Text style={styles.title}>Interview · {new Date(a.interview.proposed_at).toLocaleString('en-IN')}</Text><Text style={styles.muted}>{labelize(a.interview.mode)} · {labelize(a.interview.status)}</Text>{a.interview.details && <Text style={styles.body}>{a.interview.details}</Text>}
          <Row>{a.interview.status === 'proposed' && <PrimaryButton label="Confirm" icon="checkmark" onPress={() => run(() => supabase.rpc('respond_to_interview', { p_interview: a.interview!.id, p_action: 'confirm' }), 'Interview confirmed.')} />}
            {a.interview.status !== 'reschedule_requested' && <PrimaryButton label="Request another time" variant="secondary" onPress={() => { setNote(''); setResched(a); }} />}
            <PrimaryButton label="Decline" variant="ghost" onPress={() => run(() => supabase.rpc('respond_to_interview', { p_interview: a.interview!.id, p_action: 'decline' }), 'Interview declined.')} /></Row></Card>}
        <Row><PrimaryButton label="View job" variant="ghost" onPress={() => router.push(`/candidate/job/${a.job_id}`)} />{!['hired', 'rejected', 'withdrawn'].includes(a.stage) && <PrimaryButton label="Withdraw application" variant="secondary" icon="close-circle-outline" onPress={() => setWithdraw(a)} />}</Row>
      </Card>)}</View>
    </StateView>
    <ConfirmDialog visible={!!withdraw} destructive title="Withdraw this application?" message="The employer will no longer see it, and you cannot apply to this job again." confirmLabel="Withdraw" onCancel={() => setWithdraw(null)} onConfirm={async () => { const a = withdraw!; setWithdraw(null); await run(() => supabase.rpc('withdraw_application', { p_application: a.id }), 'Application withdrawn.'); }} />
    <ConfirmDialog visible={!!declineInvite} title="Decline this invitation?" confirmLabel="Decline" onCancel={() => setDeclineInvite(null)} onConfirm={async () => { const i = declineInvite!; setDeclineInvite(null); await run(() => supabase.rpc('respond_to_invitation', { p_invitation: i.id, p_accept: false }), 'Invitation declined.'); }} />
    <ConfirmDialog visible={!!resched} title="Request another time" confirmLabel="Send request" onCancel={() => setResched(null)} onConfirm={async () => { const a = resched!; setResched(null); await run(() => supabase.rpc('respond_to_interview', { p_interview: a.interview!.id, p_action: 'reschedule', p_note: note || null }), 'Request sent to the employer.'); }}><Field label="Preferred times (optional)" value={note} onChangeText={setNote} multiline maxLength={500} /></ConfirmDialog>
  </AppShell>;
}
const styles = StyleSheet.create({ head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, title: { color: colors.ink, fontSize: 17, fontWeight: '900' }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 }, body: { color: colors.ink, fontSize: 15, lineHeight: 22 }, timeline: { gap: 8, borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: 12 }, tl: { flexDirection: 'row', gap: 10 }, dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.teal, marginTop: 5, marginLeft: -18 }, tlTitle: { color: colors.ink, fontWeight: '700', fontSize: 14 }, interview: { backgroundColor: '#FFFAEF', borderColor: '#F3E3BC', gap: 8 } });
