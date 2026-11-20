import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../../components/AppShell';
import { Banner, Chips, Field, Row, SectionHead, StateView, unwrap, useLoad } from '../../components/kit';
import { Card, Metric, Pill, PrimaryButton } from '../../components/ui';
import { useMembership } from '../../lib/company';
import { MAX_PHOTO_BYTES, pickFile } from '../../lib/files';
import { friendlyError, labelize } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../state/AuthContext';
import { colors } from '../../theme';
import * as Crypto from 'expo-crypto';

const idTypes = [['gstin', 'GSTIN'], ['cin', 'CIN'], ['llpin', 'LLPIN'], ['domain', 'Website domain'], ['other', 'Other']].map(([id, label]) => ({ id, label }));
const EVIDENCE = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
type Dash = { jobs: Record<string, number>; pipeline: Record<string, number>; upcoming_interviews: number; pending_invitations: number };

export default function EmployerHome() {
  const { session, access } = useAuth(); const uid = session!.user.id;
  const membership = useMembership(uid); const m = membership.data;
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ legal: '', brand: '', city: '', website: '' });
  const [idType, setIdType] = useState('gstin'); const [idValue, setIdValue] = useState(''); const [evidence, setEvidence] = useState<{ path: string; name: string } | null>(null);
  const invites = useLoad(async () => (unwrap(await supabase.rpc('my_company_invitations')) ?? []) as { id: string; company_name: string; role: string }[], [uid]);
  const dash = useLoad(async () => (m?.company.verification_status === 'approved' || m?.company.verification_status === 'suspended') ? (unwrap(await supabase.rpc('employer_dashboard', { p_company: m.company.id })) as unknown as Dash) : null, [m?.company.id, m?.company.verification_status]);
  const interviews = useLoad(async () => m && m.company.verification_status === 'approved' ? ((unwrap(await supabase.rpc('company_interviews', { p_company: m.company.id })) ?? []) as { interview_id: string; job_title: string; candidate_name: string; proposed_at: string; mode: string; status: string }[]).filter((i) => new Date(i.proposed_at) > new Date()) : [], [m?.company.id, m?.company.verification_status]);

  async function act(fn: () => PromiseLike<{ error: { message?: string; code?: string } | null }>, ok?: string) {
    setBusy(true); setMsg(null); const { error } = await fn(); setBusy(false);
    if (error) return setMsg({ tone: 'error', text: friendlyError(error) });
    if (ok) setMsg({ tone: 'success', text: ok }); await membership.reload();
  }
  async function uploadEvidence() {
    try {
      const file = await pickFile(EVIDENCE, MAX_PHOTO_BYTES * 5); if (!file || !m) return;
      const path = `${m.company.id}/${Crypto.randomUUID()}.${file.ext}`;
      const { error } = await supabase.storage.from('company-evidence').upload(path, file.bytes, { contentType: file.mime }); if (error) throw error;
      setEvidence({ path, name: file.name });
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error && !('code' in e) ? e.message : friendlyError(e as { message?: string }) }); }
  }

  const status = m?.company.verification_status;
  return <AppShell role="Employer" title={m ? `${m.company.display_name} hiring desk` : 'Employer workspace'} subtitle={m ? `${labelize(status)} · ${labelize(m.role)}` : `Welcome, ${access?.display_name}`}>
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    <StateView loading={membership.loading} error={membership.error} onRetry={membership.reload}>
      {!m && <>
        {(invites.data ?? []).map((i) => <Card key={i.id} style={styles.row}><View style={{ flex: 1 }}><Text style={styles.title}>{i.company_name} invited you as {i.role}</Text><Text style={styles.muted}>Accepting gives you access to the jobs and applicants of that company.</Text></View><PrimaryButton label="Accept invitation" onPress={() => act(() => supabase.rpc('accept_company_invitation', { p_invitation: i.id }), 'Welcome to the team.')} /></Card>)}
        <Card style={{ gap: 14 }}><Pill tone="saffron">Step 1 of 2</Pill><Text style={styles.h}>Create your company workspace</Text><Text style={styles.muted}>Use the registered legal name. You will verify the company next. Jobs stay private until the trust team approves it.</Text>
          <Field label="Registered legal name" value={f.legal} onChangeText={(legal) => setF({ ...f, legal })} /><Field label="Public brand name" value={f.brand} onChangeText={(brand) => setF({ ...f, brand })} />
          <Row><Field label="City" value={f.city} onChangeText={(city) => setF({ ...f, city })} /><Field label="Website (optional)" value={f.website} onChangeText={(website) => setF({ ...f, website })} autoCapitalize="none" placeholder="https://" /></Row>
          <PrimaryButton label={busy ? 'Creating…' : 'Create workspace'} icon="business-outline" disabled={busy || f.legal.trim().length < 2 || f.brand.trim().length < 2} onPress={() => act(() => supabase.rpc('create_employer_company', { legal_name: f.legal, display_name: f.brand, city: f.city || null, website: f.website || null }))} /></Card></>}
      {m && (status === 'draft' || status === 'rejected') && <Card style={{ gap: 14 }}><Pill tone="saffron">{status === 'rejected' ? 'Verification rejected' : 'Step 2 of 2 · Verify your company'}</Pill>
        {m.company.verification_reason && <Banner tone="warn">Reviewer note: {m.company.verification_reason}</Banner>}
        {m.role !== 'owner' ? <Text style={styles.muted}>Only the company owner can submit verification.</Text> : <>
          <Text style={styles.muted}>Provide one official identifier and, if you can, a supporting document (PDF, PNG or JPG). Documents are private to you and the trust team.</Text>
          <Chips label="Identifier" options={idTypes} selected={[idType]} onToggle={setIdType} /><Field label={idTypes.find((t) => t.id === idType)!.label} value={idValue} onChangeText={setIdValue} autoCapitalize="characters" hint={idType === 'gstin' ? 'e.g. 27AAPFU0939F1ZV' : idType === 'cin' ? 'e.g. U12345MH2020PTC123456' : idType === 'llpin' ? 'e.g. AAB-1234' : undefined} />
          <Row><PrimaryButton label={evidence ? `Attached: ${evidence.name}` : 'Attach document (optional)'} variant="secondary" icon="attach-outline" onPress={uploadEvidence} /></Row>
          <PrimaryButton label={busy ? 'Submitting…' : 'Submit for verification'} icon="shield-checkmark-outline" disabled={busy || idValue.trim().length < 4} onPress={() => act(() => supabase.rpc('submit_company_verification', { p_company: m.company.id, p_identifier_type: idType, p_identifier_value: idValue, p_evidence_path: evidence?.path ?? null }), 'Submitted. You will get a notification when the review is complete.')} /></>}</Card>}
      {m && status === 'pending' && <Card style={{ gap: 8 }}><Pill tone="saffron">Verification in review</Pill><Text style={styles.h}>We are checking your company</Text><Text style={styles.muted}>You can prepare job drafts now. Publishing and candidate discovery unlock once the trust team approves your company. You will get a notification and an email.</Text><PrimaryButton label="Create a job draft" icon="add" onPress={() => router.push('/post-job')} /></Card>}
      {m && status === 'suspended' && <Banner tone="error">This company is suspended. {m.company.verification_reason ? `Reason: ${m.company.verification_reason}. ` : ''}Contact support to resolve this.</Banner>}
      {m && (status === 'approved' || status === 'suspended') && <>
        <StateView loading={dash.loading} error={dash.error} onRetry={dash.reload}>{dash.data && <>
          <View style={styles.metrics}><Metric label="Published jobs" value={`${dash.data.jobs.published ?? 0}`} icon="briefcase-outline" /><Metric label="Applications" value={`${Object.entries(dash.data.pipeline).filter(([k]) => k !== 'withdrawn').reduce((a, [, n]) => a + n, 0)}`} icon="people-outline" accent="#DDE9FF" /><Metric label="Upcoming interviews" value={`${dash.data.upcoming_interviews}`} icon="calendar-outline" accent={colors.saffronPale} /><Metric label="Open invitations" value={`${dash.data.pending_invitations}`} icon="mail-outline" accent="#FCE2DA" /></View>
          <SectionHead title="Hiring pipeline" sub="All applications across your jobs" right={<PrimaryButton label="Post a job" icon="add" disabled={status !== 'approved' || m.role === 'viewer'} onPress={() => router.push('/post-job')} />} />
          <View style={styles.metrics}>{(['applied', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'] as const).map((s) => <Card key={s} style={styles.stage}><Text style={styles.stageN}>{dash.data!.pipeline[s] ?? 0}</Text><Text style={styles.muted}>{labelize(s)}</Text></Card>)}</View>
        </>}</StateView>
        <SectionHead title="Upcoming interviews" />
        <StateView loading={interviews.loading} error={interviews.error} onRetry={interviews.reload} empty={(interviews.data ?? []).length === 0} emptyTitle="No upcoming interviews" emptyText="Shortlist a candidate and propose a time from the job's applicants.">
          {(interviews.data ?? []).map((i) => <Card key={i.interview_id} style={styles.row}><View style={{ flex: 1 }}><Text style={styles.title}>{i.candidate_name} · {i.job_title}</Text><Text style={styles.muted}>{new Date(i.proposed_at).toLocaleString('en-IN')} · {labelize(i.mode)}</Text></View><Pill tone={i.status === 'confirmed' ? 'teal' : 'saffron'}>{labelize(i.status)}</Pill></Card>)}
        </StateView></>}
    </StateView>
  </AppShell>;
}
const styles = StyleSheet.create({ metrics: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, row: { flexDirection: 'row', gap: 14, alignItems: 'center', flexWrap: 'wrap' }, title: { color: colors.ink, fontSize: 16, fontWeight: '900' }, h: { color: colors.ink, fontSize: 24, fontWeight: '900' }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 }, stage: { minWidth: 110, alignItems: 'center', padding: 14, gap: 2, flexGrow: 1 }, stageN: { color: colors.ink, fontSize: 26, fontWeight: '900' } });
