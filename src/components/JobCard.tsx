import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatExperience, formatLocation, formatSalaryRange, labelize, timeAgo } from '../lib/format';
import { colors } from '../theme';
import { Card, Pill, PrimaryButton } from './ui';

export type FeedJob = {
  job_id: string; title: string; company_id?: string; company_name: string; company_verified: boolean; city: string | null; locality: string | null; location_label?: string | null; work_mode: string;
  employment_type: string; salary_min: number; salary_max: number; salary_period: 'monthly' | 'annual'; experience_min_months: number;
  published_at: string | null; skills: string[]; saved: boolean; applied: boolean; score: number | null; eligible: boolean;
};

export function JobCard({ job, onOpen, onSave, trust }: { job: FeedJob; onOpen: () => void; onSave: () => void; trust?: string | null }) {
  return <Card style={styles.card}>
    <View style={styles.top}>
      <LinearGradient colors={['#6F70EE', '#28BED0']} style={styles.mark}><Text style={styles.letter}>{job.company_name[0]}</Text></LinearGradient>
      <View style={{ flex: 1, gap: 3 }}>
        <Text accessibilityRole="header" style={styles.title}>{job.title}</Text>
        <View style={styles.row}><Text style={styles.company}>{job.company_name}</Text>{job.company_verified && <Ionicons accessibilityLabel="Verified company" name="checkmark-circle" size={16} color={colors.teal} />}</View>
        <Text style={styles.meta}>{job.location_label ?? formatLocation(job.city, job.locality, job.work_mode)} · {labelize(job.work_mode)} · {labelize(job.employment_type)} · {timeAgo(job.published_at)}</Text>
      </View>
      <View accessibilityLabel={`Match score ${job.score ?? 'unavailable'} percent`} style={[styles.score, !job.eligible && styles.scoreOff]}><Text style={styles.scoreValue}>{job.score ?? '–'}%</Text><Text style={styles.scoreLabel}>{job.eligible ? 'match' : 'outside prefs'}</Text></View>
    </View>
    {trust && <Text style={styles.meta}>{trust}</Text>}
    <View style={styles.row}>{job.skills.slice(0, 5).map((s) => <Pill key={s} tone="neutral">{s}</Pill>)}</View>
    <View style={styles.bottom}>
      <View><Text style={styles.small}>Salary · Experience {formatExperience(job.experience_min_months)}+</Text><Text style={styles.salary}>{formatSalaryRange(job.salary_min, job.salary_max, job.salary_period)}</Text></View>
      <View style={styles.row}>
        <PrimaryButton label={job.saved ? 'Saved' : 'Save'} variant="secondary" icon={job.saved ? 'bookmark' : 'bookmark-outline'} onPress={onSave} />
        <PrimaryButton label={job.applied ? 'Applied · View' : 'View details'} icon="arrow-forward" onPress={onOpen} />
      </View>
    </View>
  </Card>;
}
const styles = StyleSheet.create({
  card: { gap: 14, borderColor: '#E8E9F4' }, top: { flexDirection: 'row', gap: 13, alignItems: 'flex-start' }, mark: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, letter: { color: '#fff', fontSize: 20, fontWeight: '900' },
  title: { color: colors.ink, fontSize: 19, fontWeight: '900' }, row: { flexDirection: 'row', gap: 7, alignItems: 'center', flexWrap: 'wrap' }, company: { color: colors.tealDark, fontWeight: '800', fontSize: 14 }, meta: { color: colors.inkSoft, fontSize: 13 },
  score: { alignItems: 'center', backgroundColor: colors.tealPale, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 8, minWidth: 74 }, scoreOff: { backgroundColor: colors.muted }, scoreValue: { color: colors.tealDark, fontWeight: '900', fontSize: 17 }, scoreLabel: { color: colors.tealDark, fontSize: 11, fontWeight: '700' },
  bottom: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }, small: { color: colors.inkSoft, fontSize: 12 }, salary: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 2 },
});
