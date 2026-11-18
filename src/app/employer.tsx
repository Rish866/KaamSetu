import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { AppShell } from '../components/AppShell';
import { Card, Metric, Pill, PrimaryButton } from '../components/ui';
import { candidates, pipeline } from '../data/mock';
import { supabase } from '../lib/supabase';
import { useDemo } from '../state/DemoContext';
import { colors } from '../theme';

export default function EmployerScreen() {
  const { width } = useWindowDimensions(); const compact = width < 720;
  const { invitedCandidates, invite } = useDemo();
  const [live, setLive] = useState(false);
  const [company, setCompany] = useState<{ id: string; display_name: string; city: string | null; verification_status: string } | null>(null);
  const [jobCount, setJobCount] = useState(0);
  const [legalName, setLegalName] = useState('Aarvya Global Ventures LLP');
  const [displayName, setDisplayName] = useState('KaamSetu');
  const [city, setCity] = useState('Navi Mumbai');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void loadEmployer(); }, []);

  async function loadEmployer() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLive(true);
    const { data } = await supabase.from('company_members').select('company_id, companies(id, display_name, city, verification_status)').eq('user_id', session.user.id).eq('active', true).maybeSingle();
    const linked = data?.companies as unknown as { id: string; display_name: string; city: string | null; verification_status: string } | null;
    if (!linked) return;
    setCompany(linked);
    const { count } = await supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('company_id', linked.id);
    setJobCount(count ?? 0);
  }

  async function createCompany() {
    setBusy(true); setMessage(null);
    const { error } = await supabase.rpc('create_employer_company', { legal_name: legalName, display_name: displayName, city, website: 'https://getkaamsetu.in' });
    setBusy(false);
    if (error) return setMessage(error.message);
    await loadEmployer();
  }

  if (live && !company) return <AppShell role="Employer" title="Set up your company" subtitle="Company verification protects candidates from impersonation">
    <Card style={styles.onboarding}><Pill tone="saffron">Verification required</Pill><Text style={styles.onboardTitle}>Create your employer workspace</Text><Text style={styles.cardText}>Use the registered legal name. Jobs remain private until the trust team verifies the company.</Text><Field label="Registered company name" value={legalName} onChangeText={setLegalName} /><Field label="Public brand name" value={displayName} onChangeText={setDisplayName} /><Field label="City" value={city} onChangeText={setCity} />{message && <Text style={styles.error}>{message}</Text>}<PrimaryButton label={busy ? 'Creating workspace…' : 'Create employer workspace'} disabled={busy} onPress={createCompany} icon="business-outline" /></Card>
  </AppShell>;

  return <AppShell role={live ? 'Employer' : 'Employer demo'} title={live && company ? `${company.display_name} hiring desk` : 'HarbourCloud hiring desk'} subtitle={live && company ? `${company.verification_status === 'approved' ? 'Verified' : 'Verification pending'} · ${company.city ?? 'India'}` : 'Verified company · Navi Mumbai'}>
    <View style={styles.metrics}><Metric label="Active jobs" value="3" icon="briefcase-outline" /><Metric label="New applicants" value="18" icon="people-outline" accent="#DDE9FF" /><Metric label="Interviews" value="4" icon="calendar-outline" accent={colors.saffronPale} /><Metric label="Response rate" value="91%" icon="pulse-outline" accent="#FCE2DA" /></View>
    <Card style={styles.activeJob}><View style={styles.jobIcon}><Ionicons name="briefcase" size={23} color={colors.teal} /></View><View style={styles.grow}><View style={styles.titleRow}><Text style={styles.cardTitle}>{live ? `${jobCount} jobs in your workspace` : 'Customer Success Executive'}</Text><Pill>{live && company?.verification_status !== 'approved' ? 'Verification pending' : 'Published'}</Pill></View><Text style={styles.cardText}>{live ? 'Every role is reviewed before it becomes public.' : 'Navi Mumbai · Hybrid · ₹5.4–7.2 LPA · 18 applicants'}</Text></View><PrimaryButton label="Post a job" icon="add" onPress={() => router.push('/post-job')} /></Card>
    <View style={styles.sectionHead}><View style={styles.sectionCopy}><Text style={styles.sectionTitle}>Hiring pipeline</Text><Text style={styles.sectionSub}>Customer Success Executive</Text></View><Pill tone="neutral">Updated now</Pill></View>
    <View style={[styles.pipeline, compact && styles.stack]}>{pipeline.map((item) => <View key={item.label} style={[styles.pipelineCard, { backgroundColor: item.color }]}><Text style={styles.pipelineValue}>{item.value}</Text><Text style={styles.pipelineLabel}>{item.label}</Text></View>)}</View>
    <View style={styles.sectionHead}><View style={styles.sectionCopy}><Text style={styles.sectionTitle}>Recommended candidates</Text><Text style={styles.sectionSub}>Only people who enabled employer discovery are shown</Text></View><PrimaryButton label="Adjust filters" variant="secondary" icon="options-outline" /></View>
    <View style={styles.candidateList}>{candidates.map((candidate) => {
      const invited = invitedCandidates.includes(candidate.id);
      return <Card key={candidate.id} style={styles.candidateCard}><View style={styles.candidateTop}><LinearGradient colors={['#6F70EE', '#2AC1D3']} style={styles.initials}><Text style={styles.initialText}>{candidate.initials}</Text></LinearGradient><View style={styles.grow}><View style={styles.titleRow}><Text style={styles.candidateName}>{candidate.name}</Text><Pill>{candidate.score}% match</Pill></View><Text style={styles.candidateTitle}>{candidate.title}</Text><Text style={styles.cardText}>{candidate.location} · {candidate.experience} · expects {candidate.expected}</Text></View></View>
        <View style={styles.skillRow}>{candidate.skills.map((skill) => <Pill key={skill} tone="neutral">{skill}</Pill>)}</View>
        <View style={[styles.candidateBottom, compact && styles.stack]}><View style={styles.masked}><Ionicons name="eye-off-outline" size={18} color={colors.inkSoft} /><Text style={styles.maskedText}>Contact and resume hidden until acceptance</Text></View><View style={styles.buttonRow}><PrimaryButton label="View match" variant="secondary" /><PrimaryButton label={invited ? 'Invite sent' : 'Invite to apply'} disabled={invited} icon={invited ? 'checkmark' : 'mail-outline'} onPress={() => invite(candidate.id)} /></View></View>
      </Card>;
    })}</View>
  </AppShell>;
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, stack: { flexDirection: 'column' }, grow: { flex: 1, gap: 5 },
  activeJob: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#F8F7FF', borderColor: '#E3E2FF' }, jobIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.tealPale, alignItems: 'center', justifyContent: 'center' }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, cardText: { color: colors.inkSoft, fontSize: 13, lineHeight: 20 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginTop: 8 }, sectionCopy: { flexGrow: 1, flexShrink: 1, minWidth: 0 }, sectionTitle: { color: colors.ink, fontSize: 24, fontWeight: '900', letterSpacing: -0.6 }, sectionSub: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 4 },
  pipeline: { flexDirection: 'row', gap: 12 }, pipelineCard: { flex: 1, minWidth: 120, borderRadius: 18, padding: 18 }, pipelineValue: { color: colors.ink, fontSize: 28, fontWeight: '900' }, pipelineLabel: { color: colors.inkSoft, marginTop: 3, fontWeight: '700' },
  candidateList: { gap: 14 }, candidateCard: { gap: 16, borderColor: '#E8E9F4' }, candidateTop: { flexDirection: 'row', gap: 13 }, initials: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, initialText: { color: '#fff', fontWeight: '900' }, candidateName: { color: colors.ink, fontSize: 18, fontWeight: '900' }, candidateTitle: { color: colors.teal, fontWeight: '800' },
  skillRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' }, candidateBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 15 }, masked: { flexDirection: 'row', gap: 7, alignItems: 'center', flex: 1 }, maskedText: { color: colors.inkSoft, fontSize: 12 }, buttonRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  onboarding: { maxWidth: 680, width: '100%', alignSelf: 'center', gap: 17, padding: 28 }, onboardTitle: { color: colors.ink, fontSize: 28, fontWeight: '900', letterSpacing: -0.7 }, field: { gap: 7 }, fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' }, input: { minHeight: 52, borderWidth: 1, borderColor: '#D8DBE7', borderRadius: 14, paddingHorizontal: 14, color: colors.ink, backgroundColor: '#FFF' }, error: { color: colors.danger, fontWeight: '700' },
});

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} style={styles.input} placeholderTextColor="#9AA1B2" /></View>; }
