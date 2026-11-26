import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../../components/AppShell';
import { LocationPicker } from '../../components/LocationPicker';
import { Banner, Chips, ConfirmDialog, Field, Row, SectionHead, StateView, unwrap, useLoad } from '../../components/kit';
import { Card, Pill, PrimaryButton } from '../../components/ui';
import { useMembership } from '../../lib/company';
import { formatExperience, formatSalaryAmount, friendlyError } from '../../lib/format';
import { type Place } from '../../lib/places';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../state/AuthContext';
import { colors } from '../../theme';

type Cand = { candidate_id: string; headline: string | null; city: string | null; locality: string | null; location_label: string | null; experience_months: number; expected_salary: number | null; salary_period: 'monthly' | 'annual'; notice_days: number | null; skills: string[]; score: number;
  match: { components: Record<string, { explanation: string; weight: number }> } };

export default function Discover() {
  const { session } = useAuth(); const membership = useMembership(session!.user.id); const m = membership.data;
  const allowed = (m?.role === 'owner' || m?.role === 'recruiter') && m.company.verification_status === 'approved';
  const jobs = useLoad(async () => m ? (unwrap(await supabase.from('jobs').select('id,title').eq('company_id', m.company.id).eq('status', 'published').order('created_at', { ascending: false })) ?? []) : [], [m?.company.id]);
  const [jobId, setJobId] = useState<string | null>(null); const [skill, setSkill] = useState(''); const [places, setPlaces] = useState<Place[]>([]); const [minY, setMinY] = useState(''); const [maxY, setMaxY] = useState('');
  const [results, setResults] = useState<Cand[] | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null); const [inviting, setInviting] = useState<Cand | null>(null); const [note, setNote] = useState('');
  const selected = jobId ?? (jobs.data ?? [])[0]?.id ?? null;

  async function search() {
    if (!selected) return; setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc('discover_candidates', { p_job: selected, p_skill: skill.trim() || null, p_places: places.length ? places.map((p) => p.id) : null, p_min_months: minY ? Math.round(Number(minY) * 12) : null, p_max_months: maxY ? Math.round(Number(maxY) * 12) : null, p_limit: 30 });
    setBusy(false); if (error) { setResults(null); return setMsg({ tone: 'error', text: friendlyError(error) }); } setResults(data as unknown as Cand[]);
  }
  return <AppShell role="Employer" title="Discover candidates" subtitle="Only people who switched on discovery appear, with private details hidden">
    {m && !allowed && <Banner tone="warn">Candidate discovery needs a verified company and a recruiter or owner role.</Banner>}
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    <StateView loading={membership.loading || jobs.loading} error={membership.error ?? jobs.error} onRetry={jobs.reload} empty={allowed && (jobs.data ?? []).length === 0} emptyTitle="Publish a job first" emptyText="Invitations are sent for a specific published job, so candidates know what they are being invited to.">
      {allowed && <><Card style={{ gap: 12 }}>
        <Chips label="Search for" options={(jobs.data ?? []).map((j) => ({ id: j.id, label: j.title }))} selected={selected ? [selected] : []} onToggle={(id) => { setJobId(id); setResults(null); }} />
        <Field label="Skill" value={skill} onChangeText={setSkill} placeholder="e.g. CRM" />
        <LocationPicker label="Candidate location (anywhere in India if empty)" value={places} onChange={setPlaces} max={20} kinds={['state', 'district', 'city', 'locality', 'pin']}
          hint="Matches where candidates live or would like to work, including people open to a whole state." />
        <Row><Field label="Min experience (years)" value={minY} onChangeText={setMinY} keyboardType="decimal-pad" /><Field label="Max experience (years)" value={maxY} onChangeText={setMaxY} keyboardType="decimal-pad" /></Row>
        <PrimaryButton label={busy ? 'Searching…' : 'Find candidates'} icon="search" disabled={busy || !selected} onPress={search} />
        <Text style={styles.muted}>Ranked by the same explainable score candidates see. Candidates outside the location, work mode or employment type of the job are excluded. Every search is logged.</Text></Card>
      {results && <><SectionHead title={`${results.length} candidate${results.length === 1 ? '' : 's'}`} />
        {results.length === 0 && <Card><Text style={styles.muted}>No consenting candidates match yet. Try fewer filters.</Text></Card>}
        {results.map((c) => <Card key={c.candidate_id} style={{ gap: 10 }}>
          <View style={styles.head}><View style={{ flex: 1 }}><Text style={styles.title}>{c.headline ?? 'Candidate'}</Text><Text style={styles.muted}>{c.location_label ?? ([c.locality, c.city].filter(Boolean).join(', ') || 'Location not shared')} · {formatExperience(c.experience_months)} · notice {c.notice_days ?? '–'} days{c.expected_salary ? ` · expects ${formatSalaryAmount(c.expected_salary, c.salary_period)}` : ''}</Text></View><Pill>{c.score}% match</Pill></View>
          <Row>{c.skills.map((s) => <Pill key={s} tone="neutral">{s}</Pill>)}</Row>
          {open === c.candidate_id && Object.entries(c.match.components).map(([k, comp]) => <Text key={k} style={styles.muted}>{k} ({comp.weight}%): {comp.explanation}</Text>)}
          <Row><PrimaryButton label={open === c.candidate_id ? 'Hide reasons' : 'Why this score'} variant="ghost" onPress={() => setOpen(open === c.candidate_id ? null : c.candidate_id)} /><PrimaryButton label="Invite to apply" icon="mail-outline" onPress={() => { setNote(''); setInviting(c); }} /></Row>
          <Text style={styles.small}>Name, email, phone and resume are hidden until the candidate applies or accepts and later agrees to share contact details.</Text></Card>)}</>}
      </>}
    </StateView>
    <ConfirmDialog visible={!!inviting} title="Invite this candidate?" message="They will see the job and your message, and can accept, decline or ignore it. Each candidate can be invited once per job." confirmLabel="Send invitation" onCancel={() => setInviting(null)}
      onConfirm={async () => { const c = inviting!; const { error } = await supabase.rpc('invite_candidate', { p_job: selected, p_candidate: c.candidate_id, p_message: note.trim() || null }); if (error) throw error; setInviting(null); setResults((r) => r?.filter((x) => x.candidate_id !== c.candidate_id) ?? r); setMsg({ tone: 'success', text: 'Invitation sent.' }); }}>
      <Field label="Message (optional)" value={note} onChangeText={setNote} multiline maxLength={1000} placeholder="Why you think they would be a good fit" /></ConfirmDialog>
  </AppShell>;
}
const styles = StyleSheet.create({ head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, title: { color: colors.ink, fontSize: 18, fontWeight: '900' }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 }, small: { color: colors.inkSoft, fontSize: 12 } });
