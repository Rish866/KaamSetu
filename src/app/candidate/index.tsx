import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../../components/AppShell';
import { JobCard, FeedJob } from '../../components/JobCard';
import { LocationPicker } from '../../components/LocationPicker';
import { Banner, Chips, Field, Row, SectionHead, StateView, unwrap, useLoad } from '../../components/kit';
import { Card, PrimaryButton } from '../../components/ui';
import { friendlyError } from '../../lib/format';
import { loadPopularCities, splitFilters, type Place } from '../../lib/places';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';

type Filters = { q: string; places: Place[]; remote: boolean; workMode: string | null; employmentType: string | null; minSalary: string; sort: string; savedOnly: boolean };
const initial: Filters = { q: '', places: [], remote: true, workMode: null, employmentType: null, minSalary: '', sort: 'match', savedOnly: false };
const modes = [['onsite', 'On-site'], ['hybrid', 'Hybrid'], ['remote', 'Remote (anywhere in India)']].map(([id, label]) => ({ id, label }));
const types = [['full_time', 'Full-time'], ['part_time', 'Part-time'], ['contract', 'Contract'], ['internship', 'Internship']].map(([id, label]) => ({ id, label }));
const sorts = [['match', 'Best match'], ['fresh', 'Newest'], ['salary', 'Highest salary']].map(([id, label]) => ({ id, label }));

export default function CandidateJobs() {
  const [draft, setDraft] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const popular = useLoad(loadPopularCities, []);
  const completion = useLoad(async () => unwrap(await supabase.rpc('my_profile_completion')) as { percent: number; missing: string[] }, []);
  const invites = useLoad(async () => (unwrap(await supabase.rpc('my_invitations')) as { status: string }[]).filter((i) => i.status === 'pending').length, []);
  const feed = useLoad(async () => { const loc = splitFilters(applied.places); return unwrap(await supabase.rpc('job_search', {
    p_query: applied.q || null, p_places: loc.places.length ? loc.places : null, p_pin_prefix: loc.pinPrefix, p_include_remote: applied.remote,
    p_min_salary: applied.minSalary ? Number(applied.minSalary) : null, p_work_mode: applied.workMode,
    p_employment_type: applied.employmentType, p_sort: applied.sort, p_saved_only: applied.savedOnly, p_limit: 50, p_offset: 0,
  })) as unknown as FeedJob[]; }, [applied]);

  async function toggleSave(job: FeedJob) {
    const { error } = await supabase.rpc('toggle_saved_job', { p_job: job.job_id });
    if (error) return setNotice(friendlyError(error));
    feed.setData((rows) => rows?.map((r) => r.job_id === job.job_id ? { ...r, saved: !r.saved } : r) ?? rows);
  }
  const pct = completion.data?.percent ?? null;

  return <AppShell role="Candidate" title="Find your next job" subtitle="Every job shows its salary. Scores explain themselves.">
    {pct !== null && pct < 100 && <Card style={styles.nudge}><View style={{ flex: 1 }}><Text style={styles.nudgeTitle}>Your profile is {pct}% complete</Text><Text style={styles.muted}>Add {completion.data?.missing.slice(0, 3).join(', ')} to improve your match scores.</Text></View><PrimaryButton label="Complete profile" icon="arrow-forward" onPress={() => router.push('/candidate/profile')} /></Card>}
    {(invites.data ?? 0) > 0 && <Card style={styles.nudge}><View style={{ flex: 1 }}><Text style={styles.nudgeTitle}>{invites.data} employer invitation{invites.data === 1 ? '' : 's'} waiting</Text><Text style={styles.muted}>Review each role before deciding.</Text></View><PrimaryButton label="Review" variant="secondary" onPress={() => router.push('/candidate/applications')} /></Card>}
    <Card style={{ gap: 14 }}>
      <Row><Field label="Search title, skill or company" value={draft.q} onChangeText={(q) => setDraft({ ...draft, q })} returnKeyType="search" onSubmitEditing={() => setApplied(draft)} placeholder="e.g. customer support, SQL, KaamSetu" /><Field label="Minimum yearly salary (₹)" value={draft.minSalary} onChangeText={(minSalary) => setDraft({ ...draft, minSalary: minSalary.replace(/\D/g, '') })} keyboardType="number-pad" /></Row>
      <LocationPicker label="Where? (anywhere in India if empty)" value={draft.places} onChange={(places) => setDraft({ ...draft, places })} max={20} allowPinPrefix
        hint="Add cities, districts, whole states, areas or a PIN code. Typing digits also offers every PIN starting with them." />
      <Chips label="Quick picks" options={[{ id: 'any', label: 'Anywhere in India' }, ...(popular.data ?? []).map((p) => ({ id: p.id, label: p.label })), { id: 'remote', label: draft.remote ? 'Remote jobs included' : 'Remote jobs hidden' }]}
        selected={[...(draft.places.length === 0 ? ['any'] : []), ...draft.places.map((p) => p.id), ...(draft.remote ? ['remote'] : [])]}
        onToggle={(id) => {
          if (id === 'any') return setDraft({ ...draft, places: [] });
          if (id === 'remote') return setDraft({ ...draft, remote: !draft.remote });
          const p = popular.data?.find((x) => x.id === id); if (!p) return;
          setDraft({ ...draft, places: draft.places.some((x) => x.id === id) ? draft.places.filter((x) => x.id !== id) : [...draft.places, p].slice(0, 20) });
        }} />
      <Chips label="Work mode" options={modes} selected={draft.workMode ? [draft.workMode] : []} onToggle={(m) => setDraft({ ...draft, workMode: draft.workMode === m ? null : m })} />
      <Chips label="Employment type" options={types} selected={draft.employmentType ? [draft.employmentType] : []} onToggle={(m) => setDraft({ ...draft, employmentType: draft.employmentType === m ? null : m })} />
      <Chips label="Sort by" options={sorts} selected={[draft.sort]} onToggle={(s) => setDraft({ ...draft, sort: s })} />
      <Row><PrimaryButton label="Search" icon="search" onPress={() => setApplied(draft)} /><PrimaryButton label={draft.savedOnly ? 'Showing saved jobs' : 'Saved jobs only'} variant="secondary" icon="bookmark-outline" onPress={() => { const next = { ...draft, savedOnly: !draft.savedOnly }; setDraft(next); setApplied(next); }} /><PrimaryButton label="Clear" variant="ghost" onPress={() => { setDraft(initial); setApplied(initial); }} /></Row>
    </Card>
    {notice && <Banner tone="error">{notice}</Banner>}
    <SectionHead title={applied.savedOnly ? 'Saved jobs' : 'Jobs for you'} sub={feed.data ? `${feed.data.length} job${feed.data.length === 1 ? '' : 's'} found` : undefined} />
    <StateView loading={feed.loading} error={feed.error} onRetry={feed.reload} empty={(feed.data ?? []).length === 0} emptyTitle="No jobs match yet" emptyText="Try fewer filters. New verified jobs appear here as soon as they are approved.">
      <View style={{ gap: 14 }}>{(feed.data ?? []).map((job) => <JobCard key={job.job_id} job={job} onSave={() => toggleSave(job)} onOpen={() => router.push({ pathname: '/candidate/job', params: { id: job.job_id } })} />)}</View>
    </StateView>
  </AppShell>;
}
const styles = StyleSheet.create({ nudge: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap', backgroundColor: '#F8F7FF', borderColor: '#E3E2FF' }, nudgeTitle: { color: colors.ink, fontWeight: '900', fontSize: 16 }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 } });
