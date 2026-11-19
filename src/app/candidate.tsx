import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { AppShell } from '../components/AppShell';
import { Card, Metric, Pill, PrimaryButton } from '../components/ui';
import { jobs, Job } from '../data/mock';
import { supabase } from '../lib/supabase';
import { useDemo } from '../state/DemoContext';
import { colors } from '../theme';

export default function CandidateScreen() {
  const { width } = useWindowDimensions(); const compact = width < 720;
  const { appliedJobs, apply, discoveryEnabled, setDiscoveryEnabled } = useDemo();
  const [live, setLive] = useState(false);
  const [name, setName] = useState('Asha');
  const [liveJobs, setLiveJobs] = useState<Job[]>([]);
  const [liveApplications, setLiveApplications] = useState<string[]>([]);
  const [liveDiscovery, setLiveDiscovery] = useState(false);
  const [inviteCount, setInviteCount] = useState(0);
  const shownJobs = live ? liveJobs : jobs;
  const shownApplications = live ? liveApplications : appliedJobs;
  const shownDiscovery = live ? liveDiscovery : discoveryEnabled;

  async function loadCandidate() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLive(true);
    setName(session.user.user_metadata?.display_name ?? 'KaamSetu member');
    const [profile, jobResult, applicationResult, invitationResult] = await Promise.all([
      supabase.from('candidate_profiles').select('discovery_enabled').eq('user_id', session.user.id).single(),
      supabase.from('jobs').select('id,title,salary_min,salary_max,salary_period,work_mode,published_at,companies(display_name,verification_status),locations(city,locality),job_skills(skills(name))').eq('status', 'published').order('published_at', { ascending: false }),
      supabase.from('applications').select('job_id').eq('candidate_id', session.user.id),
      supabase.from('job_invitations').select('id', { count: 'exact', head: true }).eq('candidate_id', session.user.id).eq('status', 'pending'),
    ]);
    setLiveDiscovery(Boolean(profile.data?.discovery_enabled));
    setLiveApplications((applicationResult.data ?? []).map((item) => item.job_id));
    setInviteCount(invitationResult.count ?? 0);
    const mapped = (jobResult.data ?? []).map((row: any) => ({
      id: row.id,
      title: row.title,
      company: row.companies?.display_name ?? 'Verified employer',
      location: [row.locations?.locality, row.locations?.city].filter(Boolean).join(', ') || 'Flexible location',
      workMode: String(row.work_mode).replace(/^./, (value) => value.toUpperCase()),
      posted: row.published_at ? new Date(row.published_at).toLocaleDateString('en-IN') : 'Recently',
      salary: row.salary_period === 'monthly' ? `₹${row.salary_min.toLocaleString('en-IN')}–₹${row.salary_max.toLocaleString('en-IN')} / month` : `₹${(row.salary_min / 100000).toFixed(1)}–${(row.salary_max / 100000).toFixed(1)} LPA`,
      score: 80,
      skills: (row.job_skills ?? []).map((item: any) => item.skills?.name).filter(Boolean).slice(0, 4),
      reasons: ['Salary disclosed', 'Location preference considered', 'Skills reviewed'],
      verified: row.companies?.verification_status === 'approved',
    }));
    setLiveJobs(mapped);
  }

  useEffect(() => { void Promise.resolve().then(loadCandidate); }, []);

  async function applyToJob(jobId: string) {
    if (!live) return apply(jobId);
    const { error } = await supabase.rpc('apply_to_job', { p_job: jobId });
    if (!error || error.code === '23505') setLiveApplications((value) => value.includes(jobId) ? value : [...value, jobId]);
  }

  async function changeDiscovery(enabled: boolean) {
    if (!live) return setDiscoveryEnabled(enabled);
    const { error } = await supabase.rpc('set_consent', { p_purpose: 'employer_discovery', p_granted: enabled, p_notice_version: '2026-11-18' });
    if (!error) setLiveDiscovery(enabled);
  }

  return <AppShell role={live ? 'Candidate' : 'Candidate demo'} title={`Good morning, ${name}`} subtitle={live ? `${liveJobs.length} published jobs available now` : 'Three new jobs fit your preferences'}>
    <View style={styles.metrics}><Metric label="Strong matches" value={`${shownJobs.length}`} icon="sparkles-outline" /><Metric label="Applications" value={`${live ? liveApplications.length : 3 + appliedJobs.length}`} icon="paper-plane-outline" accent="#DDE9FF" /><Metric label="Employer invites" value={`${live ? inviteCount : 2}`} icon="mail-unread-outline" accent={colors.saffronPale} /><Metric label="Profile strength" value={live ? 'Start' : '86%'} icon="ribbon-outline" accent="#FCE2DA" /></View>
    <Card style={styles.discovery}><View style={styles.discoveryIcon}><Ionicons name={shownDiscovery ? 'eye' : 'eye-off'} size={23} color={colors.teal} /></View><View style={styles.discoveryCopy}><Text style={styles.cardTitle}>Let verified employers discover you</Text><Text style={styles.cardText}>{shownDiscovery ? 'Your masked profile is visible. Phone, email and resume remain private.' : 'You are hidden from all new employer searches.'}</Text></View><Switch value={shownDiscovery} onValueChange={changeDiscovery} trackColor={{ false: '#BCC9C6', true: '#6DC2B6' }} thumbColor={shownDiscovery ? colors.teal : '#fff'} /></Card>
    <View style={styles.sectionHead}><View style={styles.sectionCopy}><Text style={styles.sectionTitle}>Best matches for you</Text><Text style={styles.sectionSub}>Ranked using your confirmed skills, salary and location preferences</Text></View><Pill tone="neutral">Explainable matches</Pill></View>
    <View style={styles.jobList}>{shownJobs.length ? shownJobs.map((job) => <JobCard key={job.id} job={job} applied={shownApplications.includes(job.id)} onApply={() => applyToJob(job.id)} compact={compact} />) : <Card><Text style={styles.cardTitle}>No published jobs yet</Text><Text style={styles.cardText}>Verified employers are being onboarded. New salary-visible jobs will appear here automatically.</Text></Card>}</View>
    {(!live || inviteCount > 0) && <Card style={styles.invite}><View style={styles.inviteBadge}><Ionicons name="business" size={24} color="#8A5B00" /></View><View style={styles.discoveryCopy}><Text style={styles.cardTitle}>{live ? `${inviteCount} employer invitation${inviteCount === 1 ? '' : 's'}` : 'KiteRoute Logistics invited you'}</Text><Text style={styles.cardText}>{live ? 'Review each role before deciding whether to share your application.' : 'Inside Sales Specialist · Thane · ₹4.8–6.6 LPA. Your details are still hidden until you accept.'}</Text></View><PrimaryButton label="Review invite" variant="ghost" icon="arrow-forward" /></Card>}
  </AppShell>;
}

function JobCard({ job, applied, onApply, compact }: { job: Job; applied: boolean; onApply: () => void; compact: boolean }) {
  return <Card style={styles.jobCard}><View style={styles.jobTop}><LinearGradient colors={['#6F70EE', '#28BED0']} style={styles.companyMark}><Text style={styles.companyLetter}>{job.company[0]}</Text></LinearGradient><View style={styles.jobCopy}><View style={styles.titleRow}><Text style={styles.jobTitle}>{job.title}</Text>{job.verified && <Ionicons name="checkmark-circle" size={18} color={colors.teal} />}</View><Text style={styles.company}>{job.company}</Text><Text style={styles.meta}>{job.location} · {job.workMode} · {job.posted}</Text></View><View style={styles.score}><Text style={styles.scoreValue}>{job.score}%</Text><Text style={styles.scoreLabel}>match</Text></View></View>
    <View style={styles.skillRow}>{job.skills.map((skill) => <Pill key={skill} tone="neutral">{skill}</Pill>)}</View>
    <View style={[styles.jobBottom, compact && styles.jobBottomStack]}><View><Text style={styles.salaryLabel}>Salary range</Text><Text style={styles.salary}>{job.salary}</Text></View><View style={styles.actions}><PrimaryButton label="Why this matches" variant="secondary" icon="bulb-outline" /><PrimaryButton label={applied ? 'Application sent' : 'Apply with profile'} disabled={applied} icon={applied ? 'checkmark' : 'paper-plane-outline'} onPress={onApply} /></View></View>
  </Card>;
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, stack: { flexDirection: 'column' },
  discovery: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#F8F7FF', borderColor: '#E3E2FF' }, discoveryIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.tealPale, alignItems: 'center', justifyContent: 'center' }, discoveryCopy: { flex: 1, gap: 4 },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' }, cardText: { color: colors.inkSoft, fontSize: 13, lineHeight: 20 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginTop: 8 }, sectionCopy: { flexGrow: 1, flexShrink: 1, minWidth: 0 }, sectionTitle: { color: colors.ink, fontSize: 24, fontWeight: '900', letterSpacing: -0.6 }, sectionSub: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 4 },
  jobList: { gap: 14 }, jobCard: { gap: 18, borderColor: '#E8E9F4' }, jobTop: { flexDirection: 'row', gap: 13, alignItems: 'flex-start' }, companyMark: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, companyLetter: { color: '#fff', fontSize: 20, fontWeight: '900' }, jobCopy: { flex: 1, gap: 4 }, titleRow: { flexDirection: 'row', gap: 7, alignItems: 'center', flexWrap: 'wrap' }, jobTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, company: { color: colors.teal, fontWeight: '800' }, meta: { color: colors.inkSoft, fontSize: 12 },
  score: { alignItems: 'center', backgroundColor: colors.tealPale, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 8 }, scoreValue: { color: colors.tealDark, fontWeight: '900', fontSize: 16 }, scoreLabel: { color: colors.tealDark, fontSize: 10, fontWeight: '700' }, skillRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  jobBottom: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14 }, jobBottomStack: { alignItems: 'stretch', flexDirection: 'column' }, salaryLabel: { color: colors.inkSoft, fontSize: 11 }, salary: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 2 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  invite: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFAEF' }, inviteBadge: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.saffronPale, alignItems: 'center', justifyContent: 'center' },
});
