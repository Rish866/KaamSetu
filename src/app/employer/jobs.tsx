import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../../components/AppShell';
import { Banner, ConfirmDialog, Row, SectionHead, StateView, unwrap, useLoad } from '../../components/kit';
import { Card, Pill, PrimaryButton } from '../../components/ui';
import { useMembership } from '../../lib/company';
import { formatSalaryRange, friendlyError, labelize, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../state/AuthContext';
import { colors } from '../../theme';

type J = { job_id: string; title: string; status: string; moderation_hold: string | null; work_mode: string; city: string | null; salary_min: number; salary_max: number; salary_period: 'monthly' | 'annual'; applicants: number; new_applicants: number; published_at: string | null; created_at: string };
const tone = (s: string) => (s === 'published' ? 'teal' : s === 'rejected' ? 'coral' : s === 'pending_review' || s === 'paused' ? 'saffron' : 'neutral') as 'teal' | 'coral' | 'saffron' | 'neutral';

export default function EmployerJobs() {
  const { session } = useAuth(); const membership = useMembership(session!.user.id); const m = membership.data;
  const jobs = useLoad(async () => m ? ((unwrap(await supabase.rpc('company_jobs', { p_company: m.company.id })) ?? []) as unknown as J[]) : [], [m?.company.id]);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ job: J; to: 'closed' | 'paused' } | null>(null);
  const [history, setHistory] = useState<{ id: string; rows: { to_status: string; reason: string | null; created_at: string }[] } | null>(null);
  const canEdit = m?.role === 'owner' || m?.role === 'recruiter'; const verified = m?.company.verification_status === 'approved';

  async function run(fn: () => PromiseLike<{ error: { message?: string; code?: string } | null }>, ok: string) {
    const { error } = await fn(); if (error) return setMsg({ tone: 'error', text: friendlyError(error) }); setMsg({ tone: 'success', text: ok }); await jobs.reload();
  }
  async function showHistory(id: string) {
    if (history?.id === id) return setHistory(null);
    const { data, error } = await supabase.from('job_events').select('to_status,reason,created_at').eq('job_id', id).order('created_at'); if (error) return setMsg({ tone: 'error', text: friendlyError(error) });
    setHistory({ id, rows: data ?? [] });
  }

  return <AppShell role="Employer" title="Jobs" subtitle="Draft, review, publish and manage your openings">
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    {m && !verified && <Banner tone="warn">Your company is {labelize(m.company.verification_status).toLowerCase()}. You can save drafts, but submitting for review needs approval.</Banner>}
    <SectionHead title="Your jobs" right={<PrimaryButton label="Post a job" icon="add" disabled={!canEdit} onPress={() => router.push('/post-job')} />} />
    <StateView loading={membership.loading || jobs.loading} error={membership.error ?? jobs.error} onRetry={() => { void membership.reload(); void jobs.reload(); }} empty={(jobs.data ?? []).length === 0} emptyTitle="No jobs yet" emptyText="Post your first job. Salary is required so candidates know what to expect.">
      <View style={{ gap: 12 }}>{(jobs.data ?? []).map((j) => <Card key={j.job_id} style={{ gap: 10 }}>
        <View style={styles.head}><View style={{ flex: 1 }}><Text style={styles.title}>{j.title}</Text><Text style={styles.muted}>{labelize(j.work_mode)}{j.city ? ` · ${j.city}` : ''} · {formatSalaryRange(j.salary_min, j.salary_max, j.salary_period)} · created {timeAgo(j.created_at)}</Text></View><Pill tone={tone(j.status)}>{labelize(j.status)}</Pill></View>
        {j.moderation_hold && <Banner tone="warn">{j.moderation_hold === 'admin' ? 'KaamSetu moderators have put this job on hold. Contact support to resolve it.' : 'This job was paused because your company is suspended.'}</Banner>}
        <Text style={styles.muted}>{j.applicants} applicant{j.applicants === 1 ? '' : 's'}{j.new_applicants ? ` · ${j.new_applicants} new` : ''}</Text>
        <Row>
          <PrimaryButton label="Applicants" icon="people-outline" variant="secondary" onPress={() => router.push(`/employer/job/${j.job_id}`)} />
          {canEdit && (j.status === 'draft' || j.status === 'rejected') && <><PrimaryButton label="Edit" variant="secondary" icon="create-outline" onPress={() => router.push(`/post-job?id=${j.job_id}`)} /><PrimaryButton label="Submit for review" icon="paper-plane-outline" disabled={!verified} onPress={() => run(() => supabase.rpc('submit_job_for_review', { p_job: j.job_id }), 'Submitted. A reviewer will check it shortly.')} /></>}
          {canEdit && j.status === 'published' && <PrimaryButton label="Pause" variant="secondary" onPress={() => setConfirm({ job: j, to: 'paused' })} />}
          {canEdit && j.status === 'paused' && !j.moderation_hold && <PrimaryButton label="Resume" onPress={() => run(() => supabase.rpc('set_job_status', { p_job: j.job_id, p_to: 'published' }), 'Job is live again.')} />}
          {canEdit && (j.status === 'published' || j.status === 'paused') && <PrimaryButton label="Close" variant="secondary" icon="close-circle-outline" onPress={() => setConfirm({ job: j, to: 'closed' })} />}
          {canEdit && j.status === 'closed' && !j.moderation_hold && <PrimaryButton label="Reopen" variant="secondary" onPress={() => run(() => supabase.rpc('set_job_status', { p_job: j.job_id, p_to: 'published' }), 'Job reopened.')} />}
          {canEdit && <PrimaryButton label="Duplicate" variant="ghost" icon="copy-outline" onPress={() => run(() => supabase.rpc('duplicate_job', { p_job: j.job_id }), 'A draft copy was created.')} />}
          <PrimaryButton label={history?.id === j.job_id ? 'Hide history' : 'History'} variant="ghost" onPress={() => showHistory(j.job_id)} />
        </Row>
        {history?.id === j.job_id && <View style={styles.hist}>{history.rows.map((r, i) => <Text key={i} style={styles.muted}>{new Date(r.created_at).toLocaleString('en-IN')} · {labelize(r.to_status)}{r.reason ? ` · ${r.reason}` : ''}</Text>)}</View>}
      </Card>)}</View>
    </StateView>
    <ConfirmDialog visible={!!confirm} destructive={confirm?.to === 'closed'} title={confirm?.to === 'closed' ? 'Close this job?' : 'Pause this job?'} message={confirm?.to === 'closed' ? 'Candidates can no longer apply. You can reopen it later.' : 'The job is hidden from candidates until you resume it.'} confirmLabel={confirm?.to === 'closed' ? 'Close job' : 'Pause job'} onCancel={() => setConfirm(null)}
      onConfirm={async () => { const c = confirm!; setConfirm(null); await run(() => supabase.rpc('set_job_status', { p_job: c.job.job_id, p_to: c.to }), c.to === 'closed' ? 'Job closed.' : 'Job paused.'); }} />
  </AppShell>;
}
const styles = StyleSheet.create({ head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, title: { color: colors.ink, fontSize: 18, fontWeight: '900' }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 }, hist: { gap: 4, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 } });
