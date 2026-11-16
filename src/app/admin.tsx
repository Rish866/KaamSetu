import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppShell } from '../components/AppShell';
import { Card, Metric, Pill, PrimaryButton } from '../components/ui';
import { pendingCompanies } from '../data/mock';
import { colors } from '../theme';

export default function AdminScreen() {
  const { width } = useWindowDimensions(); const compact = width < 720;
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'review'>>({});
  return <AppShell role="Admin demo" title="Trust & safety control room" subtitle="Sensitive actions are recorded in the audit trail">
    <View style={styles.metrics}><Metric label="Verification queue" value={`${pendingCompanies.length - Object.keys(decisions).length}`} icon="business-outline" /><Metric label="Jobs to review" value="4" icon="document-text-outline" accent="#DDE9FF" /><Metric label="Open reports" value="2" icon="flag-outline" accent={colors.saffronPale} /><Metric label="Privacy requests" value="1" icon="finger-print-outline" accent="#FCE2DA" /></View>
    <Card style={styles.notice}><View style={styles.noticeIcon}><Ionicons name="shield-checkmark" size={24} color={colors.teal} /></View><View style={styles.grow}><Text style={styles.cardTitle}>Admin access is intentionally limited</Text><Text style={styles.cardText}>Resumes and candidate contact details are unavailable unless a documented support or security case authorizes access.</Text></View><Pill>Audited</Pill></Card>
    <View style={styles.sectionHead}><View style={styles.sectionCopy}><Text style={styles.sectionTitle}>Company verification</Text><Text style={styles.sectionSub}>Check company identity before any job becomes public</Text></View><Pill tone="neutral">Oldest first</Pill></View>
    <View style={styles.list}>{pendingCompanies.map((company) => {
      const decision = decisions[company.id];
      return <Card key={company.id} style={styles.companyCard}><View style={styles.companyTop}><LinearGradient colors={['#6F70EE', '#2AC1D3']} style={styles.companyIcon}><Text style={styles.companyLetter}>{company.name[0]}</Text></LinearGradient><View style={styles.grow}><View style={styles.titleRow}><Text style={styles.companyName}>{company.name}</Text>{decision && <Pill tone={decision === 'approved' ? 'teal' : 'saffron'}>{decision === 'approved' ? 'Approved' : 'More info requested'}</Pill>}</View><Text style={styles.cardText}>{company.city} · Submitted {company.submitted}</Text></View></View>
        <View style={styles.evidence}><Ionicons name="document-lock-outline" size={19} color={colors.inkSoft} /><View><Text style={styles.evidenceLabel}>Verification evidence</Text><Text style={styles.evidenceValue}>{company.evidence}</Text></View></View>
        {!decision && <View style={styles.actionRow}><PrimaryButton label="Request more info" variant="secondary" icon="chatbox-outline" onPress={() => setDecisions((v) => ({ ...v, [company.id]: 'review' }))} /><PrimaryButton label="Approve company" icon="checkmark-circle-outline" onPress={() => setDecisions((v) => ({ ...v, [company.id]: 'approved' }))} /></View>}
      </Card>;
    })}</View>
    <View style={[styles.quickGrid, compact && styles.stack]}><Quick title="Job moderation" value="4 waiting" icon="briefcase-outline" tone={colors.tealPale} /><Quick title="Candidate reports" value="2 open" icon="flag-outline" tone={colors.saffronPale} /><Quick title="Audit events" value="128 today" icon="list-outline" tone="#DDE9FF" /></View>
  </AppShell>;
}

function Quick({ title, value, icon, tone }: { title: string; value: string; icon: keyof typeof Ionicons.glyphMap; tone: string }) {
  return <Card style={styles.quick}><View style={[styles.quickIcon, { backgroundColor: tone }]}><Ionicons name={icon} size={22} color={colors.tealDark} /></View><View><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardText}>{value}</Text></View><Ionicons name="chevron-forward" size={20} color={colors.inkSoft} /></Card>;
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, stack: { flexDirection: 'column' }, grow: { flex: 1, gap: 4 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#F8F7FF', borderColor: '#E3E2FF' }, noticeIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.tealPale, alignItems: 'center', justifyContent: 'center' }, cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' }, cardText: { color: colors.inkSoft, fontSize: 13, lineHeight: 20 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginTop: 8 }, sectionCopy: { flexGrow: 1, flexShrink: 1, minWidth: 0 }, sectionTitle: { color: colors.ink, fontSize: 24, fontWeight: '900', letterSpacing: -0.6 }, sectionSub: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 4 },
  list: { gap: 14 }, companyCard: { gap: 16, borderColor: '#E8E9F4' }, companyTop: { flexDirection: 'row', gap: 13 }, companyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, companyLetter: { color: '#fff', fontSize: 19, fontWeight: '900' }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, companyName: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  evidence: { flexDirection: 'row', gap: 10, backgroundColor: colors.muted, padding: 13, borderRadius: 14, alignItems: 'center' }, evidenceLabel: { color: colors.inkSoft, fontSize: 11 }, evidenceValue: { color: colors.ink, fontWeight: '800', marginTop: 2 }, actionRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
  quickGrid: { flexDirection: 'row', gap: 12 }, quick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }, quickIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
