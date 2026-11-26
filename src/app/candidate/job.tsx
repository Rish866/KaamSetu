import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../../components/AppShell';
import { ScorecardCard, type Scorecard } from '../../components/Scorecard';
import { Banner, Chips, ConfirmDialog, Field, Row, SectionHead, StateView, unwrap, useLoad } from '../../components/kit';
import { Card, Pill, PrimaryButton } from '../../components/ui';
import { formatExperience, formatLocation, formatSalaryRange, friendlyError, labelize, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';

type Component = { score: number | null; weight: number; missing: boolean; explanation: string };
type Detail = {
  id: string; title: string; description: string; company: { name: string; verified: boolean; website: string | null; description: string | null; city: string | null };
  city: string | null; locality: string | null; work_mode: string; employment_type: string; salary_min: number; salary_max: number; salary_period: 'monthly' | 'annual';
  experience_min_months: number; experience_max_months: number | null; vacancies: number; closes_at: string | null; status: string; skills: { name: string; required: boolean }[];
  saved: boolean; application_id: string | null; location_label?: string | null; last_confirmed_at?: string | null; scorecard?: Scorecard | null;
  match: { score: number; eligible: boolean; ineligible_reasons: string[]; confidence: number; version: number; components: Record<string, Component> };
};
const reportCategories = [['fee_requested', 'Asks for money'], ['fraud', 'Looks fake'], ['misleading', 'Misleading'], ['discrimination', 'Discriminatory'], ['other', 'Other']].map(([id, label]) => ({ id, label }));

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useLoad(async () => unwrap(await supabase.rpc('job_detail', { p_job: id })) as unknown as Detail | null, [id]);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [reporting, setReporting] = useState(false); const [category, setCategory] = useState('fee_requested'); const [confirmApply, setConfirmApply] = useState(false);

  async function apply() {
    setBusy(true); setMsg(null);
    const { error: e } = await supabase.rpc('apply_to_job', { p_job: id, p_note: note.trim() || null });
    setBusy(false);
    if (e) return setMsg({ tone: 'error', text: friendlyError(e) });
    setMsg({ tone: 'success', text: 'Application sent. Track it under Applications.' }); await reload();
  }
  async function toggleSave() { const { error: e } = await supabase.rpc('toggle_saved_job', { p_job: id }); if (e) setMsg({ tone: 'error', text: friendlyError(e) }); else await reload(); }
  async function report(details: string) {
    const { error: e } = await supabase.rpc('report_job', { p_job: id, p_category: category, p_details: details || null });
    if (e) { if (e.code === '23505') { setReporting(false); return setMsg({ tone: 'success', text: 'You already reported this job. Our team will review it.' }); } throw e; }
    setReporting(false); setMsg({ tone: 'success', text: 'Thank you. Our trust team will review this job.' });
  }

  return <AppShell role="Candidate" title={data?.title ?? 'Job details'} subtitle={data ? `${data.company.name} · ${data.location_label ?? formatLocation(data.city, data.locality, data.work_mode)}` : 'Loading'}>
    <PrimaryButton label="Back to jobs" variant="ghost" icon="arrow-back" onPress={() => router.canGoBack() ? router.back() : router.replace('/candidate')} />
    <StateView loading={loading} error={error} onRetry={reload} empty={!data} emptyTitle="This job is no longer available" emptyText="It may have been closed or paused.">
      {data && <>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <Card style={{ gap: 14 }}>
          <Row><Pill>{formatSalaryRange(data.salary_min, data.salary_max, data.salary_period)}</Pill><Pill tone="neutral">{labelize(data.work_mode)}</Pill><Pill tone="neutral">{labelize(data.employment_type)}</Pill><Pill tone="neutral">Experience {formatExperience(data.experience_min_months)}{data.experience_max_months ? `–${formatExperience(data.experience_max_months)}` : '+'}</Pill>{data.company.verified && <Pill tone="saffron">Verified company</Pill>}</Row>
          <Text style={styles.body}>{data.description}</Text>
          <Row>{data.skills.map((s) => <Pill key={s.name} tone={s.required ? 'teal' : 'neutral'}>{s.name}{s.required ? '' : ' (nice to have)'}</Pill>)}</Row>
          <Text style={styles.muted}>{data.vacancies} opening{data.vacancies === 1 ? '' : 's'}{data.closes_at ? ` · closes ${new Date(data.closes_at).toLocaleDateString('en-IN')}` : ''}{data.last_confirmed_at ? ` · employer confirmed it is still open ${timeAgo(data.last_confirmed_at)}` : ''}</Text>
        </Card>
        {data.scorecard && <ScorecardCard s={data.scorecard} />}
        <SectionHead title={`Why this is a ${data.match.score}% match`} sub={`Scoring version ${data.match.version}. Missing profile data is scored neutrally and listed below.`} />
        <Card style={{ gap: 12 }}>
          {!data.match.eligible && <Banner tone="warn">This job is outside your stated preferences ({data.match.ineligible_reasons.map(labelize).join(', ').toLowerCase()}). You can still apply.</Banner>}
          {Object.entries(data.match.components).map(([key, c]) => <View key={key} style={styles.comp}><View style={{ flex: 1 }}><Text style={styles.compTitle}>{labelize(key)} · {c.weight}% weight</Text><Text style={styles.muted}>{c.explanation}</Text></View><Pill tone={c.missing ? 'neutral' : 'teal'}>{c.missing ? 'Missing data' : `${Math.round(c.score ?? 0)}/100`}</Pill></View>)}
        </Card>
        <Card style={{ gap: 12 }}>
          {data.application_id ? <><Text style={styles.compTitle}>You have applied to this job.</Text><PrimaryButton label="Track application" icon="arrow-forward" onPress={() => router.push('/candidate/applications')} /></> : data.status !== 'published' ? <Text style={styles.muted}>This job is not accepting applications.</Text> : <>
            <Field label="Note to the employer (optional)" value={note} onChangeText={setNote} multiline maxLength={1000} hint="Your name and profile are shared when you apply. Your email and phone stay private until you are shortlisted and agree." />
            <Row><PrimaryButton label={busy ? 'Sending…' : 'Apply with my profile'} disabled={busy} icon="paper-plane-outline" onPress={() => setConfirmApply(true)} /><PrimaryButton label={data.saved ? 'Saved' : 'Save for later'} variant="secondary" icon={data.saved ? 'bookmark' : 'bookmark-outline'} onPress={toggleSave} /></Row></>}
          <PrimaryButton label="Report this job" variant="ghost" icon="flag-outline" onPress={() => setReporting(true)} />
        </Card>
        <ConfirmDialog visible={confirmApply} title="Send your application?" message="The employer will see your name, profile, skills, match score and your resume (once it has passed security checks). Your email and phone stay hidden until you are shortlisted and agree in Settings. You can withdraw later." confirmLabel="Send application" onCancel={() => setConfirmApply(false)} onConfirm={async () => { setConfirmApply(false); await apply(); }} />
        <ConfirmDialog visible={reporting} title="Report this job" confirmLabel="Send report" destructive requireReason minReason={5} onCancel={() => setReporting(false)} onConfirm={report} message="Tell us what is wrong. Never pay money to get a job."><Chips label="Category" options={reportCategories} selected={[category]} onToggle={setCategory} /></ConfirmDialog>
      </>}
    </StateView>
  </AppShell>;
}
const styles = StyleSheet.create({ body: { color: colors.ink, fontSize: 16, lineHeight: 26 }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 }, comp: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 4 }, compTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 } });
