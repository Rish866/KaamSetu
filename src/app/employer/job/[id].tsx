import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../../../components/AppShell';
import { Banner, Chips, ConfirmDialog, Field, Row, StateView, unwrap, useLoad } from '../../../components/kit';
import { Card, Pill, PrimaryButton } from '../../../components/ui';
import { useMembership } from '../../../lib/company';
import { formatExperience, friendlyError, labelize, parseLocalDateTime, stageLabels, timeAgo } from '../../../lib/format';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../state/AuthContext';
import { colors } from '../../../theme';

type Applicant = { application_id: string; candidate_id: string; display_name: string; headline: string | null; experience_months: number; stage: string; applied_at: string; note: string | null; score: number | null;
  match: { components?: Record<string, { score: number | null; explanation: string; weight: number }> } | null };
type Iv = { interview_id: string; application_id: string; proposed_at: string; mode: string; status: string; response_note: string | null };
const stages = ['applied', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'];
const next: Record<string, string[]> = { applied: ['viewed', 'shortlisted', 'rejected'], viewed: ['shortlisted', 'rejected'], shortlisted: ['interview', 'rejected'], interview: ['offer', 'rejected'], offer: ['hired', 'rejected'] };
const modes = [['phone', 'Phone'], ['video', 'Video'], ['onsite', 'On-site']].map(([id, label]) => ({ id, label }));

export default function JobApplicants() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { session } = useAuth();
  const membership = useMembership(session!.user.id); const m = membership.data; const canAct = (m?.role === 'owner' || m?.role === 'recruiter') && m.company.verification_status === 'approved';
  const apps = useLoad(async () => (unwrap(await supabase.rpc('list_job_applicants', { p_job: id })) ?? []) as unknown as Applicant[], [id]);
  const ivs = useLoad(async () => m ? ((unwrap(await supabase.rpc('company_interviews', { p_company: m.company.id })) ?? []) as unknown as Iv[]) : [], [m?.company.id]);
  const job = useLoad(async () => unwrap(await supabase.from('jobs').select('title,status').eq('id', id).single()), [id]);
  const [filter, setFilter] = useState<string | null>(null); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [dlg, setDlg] = useState<{ kind: 'reject' | 'offer' | 'interview'; a: Applicant } | null>(null);
  const [when, setWhen] = useState(''); const [mode, setMode] = useState('video'); const [details, setDetails] = useState('');
  const [contact, setContact] = useState<Record<string, { email: string | null; email_verified: boolean; phone: string | null; phone_verified: boolean }>>({});

  const bad = (e: { message?: string; code?: string }) => setMsg({ tone: 'error', text: friendlyError(e) });
  async function refresh() { await Promise.all([apps.reload(), ivs.reload()]); }
  async function move(a: Applicant, to: string, reason?: string, det?: string) {
    const { error } = await supabase.rpc('transition_application', { p_application: a.application_id, p_to: to, p_reason: reason ?? null, p_details: det ?? null });
    if (error) return bad(error); setMsg({ tone: 'success', text: `${a.display_name} moved to ${stageLabels[to] ?? to}.` }); await refresh();
  }
  async function reveal(a: Applicant) {
    const { data, error } = await supabase.rpc('get_applicant_contact', { p_application: a.application_id }); if (error) return bad(error);
    const row = (data as { email: string | null; email_verified: boolean; phone: string | null; phone_verified: boolean }[])[0]; setContact({ ...contact, [a.application_id]: row });
  }
  // The resume is shared with the employer when the candidate applies; access is logged and the link expires in 60 seconds.
  async function openResume(a: Applicant) {
    const { data: path, error } = await supabase.rpc('get_applicant_resume', { p_application: a.application_id }); if (error) return bad(error);
    const { data, error: e2 } = await supabase.storage.from('resumes').createSignedUrl(path as string, 60); if (e2 || !data) return bad(e2 ?? { message: 'Could not open the resume.' });
    await Linking.openURL(data.signedUrl);
  }
  const all = apps.data ?? []; const shown = all.filter((a) => (!filter || a.stage === filter) && (!q || `${a.display_name} ${a.headline ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const count = (s: string) => all.filter((a) => a.stage === s).length;

  return <AppShell role="Employer" title={job.data?.title ?? 'Applicants'} subtitle={`${all.length} applicant${all.length === 1 ? '' : 's'} · ${job.data ? labelize(job.data.status) : ''}`}>
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    <Card style={{ gap: 12 }}><Field label="Search applicants" value={q} onChangeText={setQ} placeholder="Name or headline" />
      <Chips label="Pipeline stage" options={[{ id: 'all', label: `All (${all.length})` }, ...stages.map((s) => ({ id: s, label: `${stageLabels[s]} (${count(s)})` }))]} selected={[filter ?? 'all']} onToggle={(s) => setFilter(s === 'all' ? null : s)} />
      <Text style={styles.muted}>Applying shares the security-checked resume of the candidate with you. Email and phone stay hidden until you shortlist a candidate who has agreed to share them. Exporting applicant lists is disabled to protect candidate privacy.</Text></Card>
    <StateView loading={apps.loading || membership.loading} error={apps.error} onRetry={apps.reload} empty={shown.length === 0} emptyTitle="No applicants here" emptyText="Applicants appear as soon as candidates apply.">
      <View style={{ gap: 12 }}>{shown.map((a) => {
        const iv = (ivs.data ?? []).find((i) => i.application_id === a.application_id && i.status !== 'cancelled'); const c = contact[a.application_id];
        return <Card key={a.application_id} style={{ gap: 10 }}>
          <View style={styles.head}><View style={{ flex: 1 }}><Text style={styles.title}>{a.display_name}</Text><Text style={styles.muted}>{a.headline ?? 'No headline'} · {formatExperience(a.experience_months)} · applied {timeAgo(a.applied_at)}</Text></View><View style={{ alignItems: 'flex-end', gap: 6 }}><Pill>{a.score ?? '–'}% match</Pill><Pill tone={a.stage === 'rejected' ? 'coral' : 'neutral'}>{stageLabels[a.stage]}</Pill></View></View>
          {a.note && <Text style={styles.note}>“{a.note}”</Text>}
          {iv && <Banner tone={iv.status === 'confirmed' ? 'success' : iv.status === 'reschedule_requested' ? 'warn' : 'info'}>Interview {new Date(iv.proposed_at).toLocaleString('en-IN')} · {labelize(iv.mode)} · {labelize(iv.status)}{iv.response_note ? ` · Candidate: ${iv.response_note}` : ''}</Banner>}
          {open === a.application_id && a.match?.components && <View style={{ gap: 4 }}>{Object.entries(a.match.components).map(([k, comp]) => <Text key={k} style={styles.muted}>{labelize(k)} ({comp.weight}%): {comp.explanation}</Text>)}</View>}
          {c && <Banner tone="success">Email: {c.email ?? '–'}{c.email && !c.email_verified ? ' (not verified)' : ''} · Phone: {c.phone ?? '–'}{c.phone && !c.phone_verified ? ' (not verified by SMS)' : ''}. This disclosure is logged and visible to the candidate.</Banner>}
          <Row><PrimaryButton label={open === a.application_id ? 'Hide match details' : 'Why this score'} variant="ghost" onPress={() => setOpen(open === a.application_id ? null : a.application_id)} />
            {canAct && (next[a.stage] ?? []).map((to) => to === 'rejected' ? <PrimaryButton key={to} label="Reject" variant="secondary" onPress={() => setDlg({ kind: 'reject', a })} /> : to === 'interview' ? <PrimaryButton key={to} label={iv ? 'Reschedule interview' : 'Propose interview'} icon="calendar-outline" onPress={() => { setWhen(''); setDetails(''); setDlg({ kind: 'interview', a }); }} /> : to === 'offer' ? <PrimaryButton key={to} label="Make offer" icon="ribbon-outline" onPress={() => { setDetails(''); setDlg({ kind: 'offer', a }); }} /> : <PrimaryButton key={to} label={to === 'viewed' ? 'Mark viewed' : to === 'shortlisted' ? 'Shortlist' : 'Mark hired'} variant={to === 'shortlisted' || to === 'hired' ? 'primary' : 'secondary'} onPress={() => move(a, to)} />)}
            {canAct && a.stage === 'interview' && iv && <PrimaryButton label="Cancel interview" variant="ghost" onPress={async () => { const { error } = await supabase.rpc('cancel_interview', { p_interview: iv.interview_id }); if (error) return bad(error); await refresh(); }} />}
            {canAct && a.stage !== 'withdrawn' && <PrimaryButton label="Open resume" variant="secondary" icon="document-text-outline" onPress={() => openResume(a)} />}
            {canAct && ['shortlisted', 'interview', 'offer', 'hired'].includes(a.stage) && !c && <PrimaryButton label="View contact details" variant="secondary" icon="call-outline" onPress={() => reveal(a)} />}</Row>
        </Card>;
      })}</View>
    </StateView>
    <ConfirmDialog visible={dlg?.kind === 'reject'} destructive requireReason minReason={3} title={`Reject ${dlg?.a.display_name}?`} message="The candidate will see this reason, so keep it respectful and specific." confirmLabel="Reject candidate" onCancel={() => setDlg(null)} onConfirm={async (reason) => { const a = dlg!.a; setDlg(null); await move(a, 'rejected', reason); }} />
    <ConfirmDialog visible={dlg?.kind === 'offer'} title={`Make an offer to ${dlg?.a.display_name}`} confirmLabel="Send offer" onCancel={() => setDlg(null)} onConfirm={async () => { if (details.trim().length < 5) throw { message: 'Add the offer details (role, salary, joining date).', code: '22023' }; const a = dlg!.a; setDlg(null); await move(a, 'offer', undefined, details.trim()); }}><Field label="Offer details" value={details} onChangeText={setDetails} multiline placeholder="Role, salary, joining date" /></ConfirmDialog>
    <ConfirmDialog visible={dlg?.kind === 'interview'} title={`Interview with ${dlg?.a.display_name}`} confirmLabel="Send proposal" onCancel={() => setDlg(null)} onConfirm={async () => { const iso = parseLocalDateTime(when); if (!iso) throw { message: 'Enter the time as YYYY-MM-DD HH:MM, for example 2026-12-01 15:30.', code: '22023' }; const a = dlg!.a; const { error } = await supabase.rpc('propose_interview', { p_application: a.application_id, p_at: iso, p_mode: mode, p_details: details || null }); if (error) throw error; setDlg(null); setMsg({ tone: 'success', text: 'Interview proposed. The candidate can confirm or ask for another time.' }); await refresh(); }}>
      <Field label="Date and time (your local time)" value={when} onChangeText={setWhen} placeholder="2026-12-01 15:30" /><Chips label="Mode" options={modes} selected={[mode]} onToggle={setMode} /><Field label="Meeting link or address" value={details} onChangeText={setDetails} multiline /></ConfirmDialog>
  </AppShell>;
}
const styles = StyleSheet.create({ head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, title: { color: colors.ink, fontSize: 18, fontWeight: '900' }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 }, note: { color: colors.ink, fontStyle: 'italic', fontSize: 15 } });
