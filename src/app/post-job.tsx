import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Logo, PrimaryButton } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

export default function PostJobScreen() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAccount() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.replace('/login?role=employer');
    setUserId(session.user.id);
    const { data } = await supabase.from('company_members').select('company_id').eq('user_id', session.user.id).eq('active', true).maybeSingle();
    if (!data) return router.replace('/employer');
    setCompanyId(data.company_id);
  }

  useEffect(() => { void Promise.resolve().then(loadAccount); }, []);

  async function submit() {
    const min = Number(salaryMin); const max = Number(salaryMax);
    if (!companyId || !userId) return;
    if (title.trim().length < 2 || description.trim().length < 20) return setMessage('Add a job title and at least 20 characters of description.');
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) return setMessage('Enter a valid annual salary range.');
    setBusy(true); setMessage(null);
    const { error } = await supabase.from('jobs').insert({
      company_id: companyId,
      title: title.trim(),
      description: description.trim(),
      salary_min: min,
      salary_max: max,
      salary_period: 'annual',
      work_mode: 'hybrid',
      employment_type: 'full_time',
      vacancies: 1,
      status: 'pending_review',
      created_by: userId,
    });
    setBusy(false);
    if (error) return setMessage(error.message);
    router.replace('/employer');
  }

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}><View style={styles.head}><Logo /><PrimaryButton label="Back" variant="ghost" onPress={() => router.back()} /></View><Card style={styles.card}><Text style={styles.title}>Post a job</Text><Text style={styles.sub}>Salary visibility is required. New jobs go to the verification queue before publication.</Text><Field label="Job title" value={title} onChangeText={setTitle} placeholder="Customer Success Executive" /><Field label="Description" value={description} onChangeText={setDescription} placeholder="Describe the responsibilities, requirements and work schedule" multiline /><View style={styles.row}><Field label="Minimum annual salary (₹)" value={salaryMin} onChangeText={setSalaryMin} keyboardType="number-pad" placeholder="500000" /><Field label="Maximum annual salary (₹)" value={salaryMax} onChangeText={setSalaryMax} keyboardType="number-pad" placeholder="700000" /></View>{message && <Text style={styles.message}>{message}</Text>}<PrimaryButton label={busy ? 'Submitting…' : 'Submit for review'} disabled={busy} onPress={submit} icon="paper-plane-outline" /></Card></ScrollView></SafeAreaView>;
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) { const { label, multiline, ...input } = props; return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...input} multiline={multiline} style={[styles.input, multiline && styles.multiline]} placeholderTextColor="#9AA1B2" /></View>; }

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.cream }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 22, gap: 20 }, head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, card: { padding: 28, gap: 18 }, title: { color: colors.ink, fontSize: 30, fontWeight: '900' }, sub: { color: colors.inkSoft, lineHeight: 22 }, field: { flex: 1, gap: 7 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, input: { minHeight: 52, borderWidth: 1, borderColor: '#D8DBE7', borderRadius: 14, paddingHorizontal: 14, color: colors.ink, backgroundColor: '#FFF' }, multiline: { minHeight: 130, paddingTop: 14, textAlignVertical: 'top' }, row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, message: { color: colors.danger, fontWeight: '700' } });
