import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LocationPicker } from '../components/LocationPicker';
import { Card, Logo, PrimaryButton } from '../components/ui';
import { friendlyError } from '../lib/format';
import { loadPlaces, type Place } from '../lib/places';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

type Option = { id: string; label: string };
const workModes = [['onsite', 'On-site'], ['hybrid', 'Hybrid'], ['remote', 'Remote']] as const;
type Question = { kind: 'yes_no' | 'short_text'; prompt: string; required: boolean };
const questionKinds = [{ id: 'yes_no', label: 'Yes / No' }, { id: 'short_text', label: 'Short answer' }];
const officeDayOptions = [1, 2, 3, 4, 5, 6].map((n) => ({ id: String(n), label: `${n} day${n === 1 ? '' : 's'}` }));
const employmentTypes = [['full_time', 'Full-time'], ['part_time', 'Part-time'], ['contract', 'Contract'], ['internship', 'Internship']] as const;

export default function PostJobScreen() {
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [skills, setSkills] = useState<Option[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [expMin, setExpMin] = useState('0');
  const [expMax, setExpMax] = useState('');
  const [workMode, setWorkMode] = useState<(typeof workModes)[number][0]>('hybrid');
  const [employmentType, setEmploymentType] = useState<(typeof employmentTypes)[number][0]>('full_time');
  const [place, setPlace] = useState<Place | null>(null);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [officeDays, setOfficeDays] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAccount() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.replace('/login?role=employer');
    setUserId(session.user.id);
    const { data } = await supabase.from('company_members').select('company_id, companies(verification_status)').eq('user_id', session.user.id).eq('active', true).maybeSingle();
    if (!data) return router.replace('/employer');
    setCompanyId(data.company_id);
    setApproved((data.companies as unknown as { verification_status: string } | null)?.verification_status === 'approved');
    const sk = await supabase.from('skills').select('id, name').eq('active', true).order('name');
    setSkills((sk.data ?? []).map((k) => ({ id: k.id, label: k.name })));
    if (editId) {
      const [j, js] = await Promise.all([supabase.from('jobs').select('title,description,salary_min,salary_max,experience_min_months,experience_max_months,work_mode,employment_type,location_id,status,office_days').eq('id', editId).eq('company_id', data.company_id).single(), supabase.from('job_skills').select('skill_id').eq('job_id', editId)]);
      const qs = await supabase.from('job_questions').select('kind,prompt,required,position').eq('job_id', editId).order('position');
      setQuestions(((qs.data ?? []) as (Question & { position: number })[]).map(({ kind, prompt, required }) => ({ kind, prompt, required })));
      if (j.error || !j.data || !['draft', 'rejected'].includes(j.data.status)) return setMessage('Only drafts and rejected jobs can be edited.');
      const d = j.data;
      setTitle(d.title); setDescription(d.description); setSalaryMin(String(d.salary_min)); setSalaryMax(String(d.salary_max)); setExpMin(String(d.experience_min_months / 12));
      setExpMax(d.experience_max_months === null ? '' : String(d.experience_max_months / 12)); setWorkMode(d.work_mode); setEmploymentType(d.employment_type); setPlace((await loadPlaces([d.location_id]))[0] ?? null); setSkillIds((js.data ?? []).map((x) => x.skill_id)); setOfficeDays(d.office_days ? String(d.office_days) : null);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void Promise.resolve().then(loadAccount); }, []);

  async function save(submitForReview: boolean) {
    const min = Number(salaryMin); const max = Number(salaryMax);
    const eMin = Math.round(Number(expMin || 0) * 12); const eMax = expMax.trim() === '' ? null : Math.round(Number(expMax) * 12);
    if (!companyId || !userId) return;
    if (title.trim().length < 2) return setMessage('Add a job title.');
    if (description.trim().length < 50) return setMessage('Describe the role in at least 50 characters.');
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return setMessage('Enter a valid annual salary range. Salary must be visible to candidates.');
    if (!Number.isFinite(eMin) || eMin < 0 || (eMax !== null && (!Number.isFinite(eMax) || eMax < eMin))) return setMessage('Enter a valid experience range in years.');
    if (workMode !== 'remote' && !place) return setMessage('Choose where the job is: city, area or PIN code.');
    if (skillIds.length === 0) return setMessage('Choose at least one required skill.');
    const asked = questions.map((q) => ({ ...q, prompt: q.prompt.trim() })).filter((q) => q.prompt.length > 0);
    if (asked.some((q) => q.prompt.length < 5 || q.prompt.length > 200)) return setMessage('Each question needs 5 to 200 characters.');
    setBusy(true); setMessage(null);
    const payload = {
      title: title.trim(), description: description.trim(), salary_min: min, salary_max: max, salary_period: 'annual',
      experience_min_months: eMin, experience_max_months: eMax, location_id: workMode === 'remote' ? null : place?.id ?? null, work_mode: workMode, employment_type: employmentType, vacancies: 1,
      office_days: workMode === 'hybrid' && officeDays ? Number(officeDays) : null,
    };
    let jobId = editId ?? null;
    if (jobId) {
      const { error } = await supabase.from('jobs').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', jobId);
      if (error) { setBusy(false); return setMessage(friendlyError(error)); }
      await supabase.from('job_skills').delete().eq('job_id', jobId);
    } else {
      const { data, error } = await supabase.from('jobs').insert({ ...payload, company_id: companyId, created_by: userId }).select('id').single();
      if (error || !data) { setBusy(false); return setMessage(friendlyError(error)); }
      jobId = data.id;
    }
    const skillResult = await supabase.from('job_skills').insert(skillIds.map((skill_id) => ({ job_id: jobId!, skill_id })));
    if (skillResult.error) { setBusy(false); return setMessage(friendlyError(skillResult.error)); }
    const qResult = await supabase.rpc('set_job_questions', { p_job: jobId!, p_questions: asked });
    if (qResult.error) { setBusy(false); return setMessage(friendlyError(qResult.error)); }
    if (submitForReview) {
      const submitted = await supabase.rpc('submit_job_for_review', { p_job: jobId });
      if (submitted.error) { setBusy(false); return setMessage(`Saved as a draft. ${friendlyError(submitted.error)}`); }
    }
    setBusy(false);
    router.replace('/employer/jobs');
  }

  const toggle = (id: string) => setSkillIds((value) => value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}><View style={styles.head}><Logo /><PrimaryButton label="Back" variant="ghost" onPress={() => router.back()} /></View><Card style={styles.card}><Text style={styles.title}>{editId ? 'Edit job' : 'Post a job'}</Text><Text style={styles.sub}>Salary visibility is required. Jobs are reviewed by the trust team before they become public.{approved ? '' : ' Your company must be verified before you can submit a job for review. You can still save drafts.'}</Text>
    <Field label="Job title" value={title} onChangeText={setTitle} placeholder="Customer Success Executive" />
    <Field label="Description" value={description} onChangeText={setDescription} placeholder="Describe the responsibilities, requirements and work schedule" multiline />
    <Choice label="Work mode" options={workModes.map(([id, label]) => ({ id, label }))} selected={[workMode]} onToggle={(id) => setWorkMode(id as typeof workMode)} />
    <Choice label="Employment type" options={employmentTypes.map(([id, label]) => ({ id, label }))} selected={[employmentType]} onToggle={(id) => setEmploymentType(id as typeof employmentType)} />
    {workMode !== 'remote' && <LocationPicker label="Job location" value={place ? [place] : []} onChange={(v) => setPlace(v[0] ?? null)} kinds={['district', 'city', 'locality', 'pin']}
      placeholder="Type the city, area or PIN code" hint="Anywhere in India. A PIN code or area helps candidates nearby find the job." />}
    {workMode === 'hybrid' && <Choice label="Office days per week (optional)" options={officeDayOptions} selected={officeDays ? [officeDays] : []} onToggle={(id) => setOfficeDays(officeDays === id ? null : id)} />}
    {workMode === 'remote' && <Text style={styles.sub}>Remote jobs are shown to candidates anywhere in India.</Text>}
    <Choice label="Required skills" options={skills} selected={skillIds} onToggle={toggle} />
    <View style={styles.row}><Field label="Minimum annual salary (₹)" value={salaryMin} onChangeText={setSalaryMin} keyboardType="number-pad" placeholder="500000" /><Field label="Maximum annual salary (₹)" value={salaryMax} onChangeText={setSalaryMax} keyboardType="number-pad" placeholder="700000" /></View>
    <View style={styles.row}><Field label="Minimum experience (years)" value={expMin} onChangeText={setExpMin} keyboardType="decimal-pad" /><Field label="Maximum experience (years, optional)" value={expMax} onChangeText={setExpMax} keyboardType="decimal-pad" /></View>
    <View style={styles.choice}><Text style={styles.label}>Readiness questions (optional, up to 2)</Text>
      <Text style={styles.sub}>Ask what really decides the hire, for example night shifts or notice period. Answers are seen only by your company. Questions cannot change after candidates apply.</Text>
      {questions.map((q, i) => <Card key={i} style={styles.question}>
        <Field label={`Question ${i + 1}`} value={q.prompt} onChangeText={(t) => setQuestions(questions.map((x, j) => j === i ? { ...x, prompt: t } : x))} maxLength={200} placeholder={q.kind === 'yes_no' ? 'Can you work rotational night shifts?' : 'What is your notice period?'} />
        <Choice label="Answer type" options={questionKinds} selected={[q.kind]} onToggle={(id) => setQuestions(questions.map((x, j) => j === i ? { ...x, kind: id as Question['kind'] } : x))} />
        <View style={styles.row}><Choice label="Must answer to apply" options={[{ id: 'yes', label: 'Required' }, { id: 'no', label: 'Optional' }]} selected={[q.required ? 'yes' : 'no']} onToggle={(id) => setQuestions(questions.map((x, j) => j === i ? { ...x, required: id === 'yes' } : x))} />
          <PrimaryButton label="Remove" variant="ghost" icon="trash-outline" onPress={() => setQuestions(questions.filter((_, j) => j !== i))} /></View>
      </Card>)}
      {questions.length < 2 && <PrimaryButton label="Add a question" variant="secondary" icon="add" onPress={() => setQuestions([...questions, { kind: 'yes_no', prompt: '', required: true }])} />}
    </View>
    {message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
    <View style={styles.row}><PrimaryButton label={busy ? 'Saving…' : 'Save draft'} variant="secondary" disabled={busy} onPress={() => save(false)} icon="save-outline" /><PrimaryButton label={busy ? 'Submitting…' : 'Submit for review'} disabled={busy || !approved} onPress={() => save(true)} icon="paper-plane-outline" /></View></Card></ScrollView></SafeAreaView>;
}

function Choice({ label, options, selected, onToggle }: { label: string; options: Option[]; selected: string[]; onToggle: (id: string) => void }) {
  return <View style={styles.choice}><Text style={styles.label}>{label}</Text><View style={styles.row}>{options.map((o) => <Pressable key={o.id} accessibilityRole="button" accessibilityState={{ selected: selected.includes(o.id) }} onPress={() => onToggle(o.id)} style={[styles.chip, selected.includes(o.id) && styles.chipOn]}><Text style={[styles.chipText, selected.includes(o.id) && styles.chipTextOn]}>{o.label}</Text></Pressable>)}</View></View>;
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) { const { label, multiline, ...input } = props; return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} {...input} multiline={multiline} style={[styles.input, multiline && styles.multiline]} placeholderTextColor="#9AA1B2" /></View>; }

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.cream }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 22, gap: 20 }, head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, card: { padding: 28, gap: 18 }, title: { color: colors.ink, fontSize: 30, fontWeight: '900' }, sub: { color: colors.inkSoft, lineHeight: 22 }, field: { flex: 1, gap: 7 }, choice: { gap: 7 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, input: { minHeight: 52, borderWidth: 1, borderColor: '#D8DBE7', borderRadius: 14, paddingHorizontal: 14, color: colors.ink, backgroundColor: '#FFF' }, multiline: { minHeight: 130, paddingTop: 14, textAlignVertical: 'top' }, row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, message: { color: colors.danger, fontWeight: '700' }, chip: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: '#D8DBE7', backgroundColor: '#FFF' }, chipOn: { backgroundColor: colors.teal, borderColor: colors.teal }, chipText: { color: colors.ink, fontSize: 14, fontWeight: '700' }, chipTextOn: { color: '#FFF' }, question: { gap: 12, padding: 16 } });
