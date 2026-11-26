import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../../components/AppShell';
import { LocationPicker } from '../../components/LocationPicker';
import { Banner, Chips, ConfirmDialog, Field, Option, Row, SectionHead, StateView, unwrap, useLoad } from '../../components/kit';
import { Card, Pill, PrimaryButton } from '../../components/ui';
import { NOTICE_VERSION } from '../../content/legal';
import { MAX_PHOTO_BYTES, MAX_RESUME_BYTES, openWhenReady, PHOTO_TYPES, pickFile, RESUME_TYPES, resumeLink, uploadResume } from '../../lib/files';
import { formatExperience, formatSalaryAmount, friendlyError, labelize } from '../../lib/format';
import { usePlatformFlags } from '../../lib/platform';
import { loadPlaces, type Place } from '../../lib/places';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../state/AuthContext';
import { colors } from '../../theme';

type Profile = { headline: string | null; experience_months: number; current_location_id: string | null; salary_min: number | null; current_salary: number | null; salary_period: 'monthly' | 'annual';
  notice_days: number | null; discovery_enabled: boolean; employment_status: string | null; work_modes: string[]; employment_types: string[]; photo_path: string | null };
type Bundle = { profile: Profile; current: Place | null; preferred: Place[]; skills: string[]; locations: { location_id: string; preference_rank: number }[]; education: any[]; experience: any[]; certs: any[]; languages: any[]; resumes: any[]; extraction: any | null };
const statuses = [['employed', 'Employed'], ['unemployed', 'Not working'], ['student', 'Student'], ['freelancing', 'Freelancing'], ['notice_period', 'Serving notice']].map(([id, label]) => ({ id, label }));
const modes = [['onsite', 'On-site'], ['hybrid', 'Hybrid'], ['remote', 'Remote']].map(([id, label]) => ({ id, label }));
const types = [['full_time', 'Full-time'], ['part_time', 'Part-time'], ['contract', 'Contract'], ['internship', 'Internship']].map(([id, label]) => ({ id, label }));
const levels = ['basic', 'conversational', 'fluent', 'native'].map((id) => ({ id, label: labelize(id) }));
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, '')));

export default function ProfileScreen() {
  const { session, access } = useAuth(); const uid = session!.user.id;
  const taxonomy = useLoad(async () => {
    const s = await supabase.from('skills').select('id,name').eq('active', true).order('name');
    return { skills: (unwrap(s) ?? []).map((x) => ({ id: x.id, label: x.name })) as Option[] };
  }, []);
  const bundle = useLoad(async (): Promise<Bundle> => {
    const [p, cs, cl, ed, ex, ce, la, re, xt] = await Promise.all([
      supabase.from('candidate_profiles').select('*').eq('user_id', uid).single(), supabase.from('candidate_skills').select('skill_id').eq('candidate_id', uid).eq('confirmed', true),
      supabase.from('candidate_locations').select('location_id,preference_rank').eq('candidate_id', uid).order('preference_rank'), supabase.from('candidate_education').select('*').eq('candidate_id', uid).order('end_year', { ascending: false }),
      supabase.from('candidate_experience').select('*').eq('candidate_id', uid).order('start_date', { ascending: false }), supabase.from('candidate_certifications').select('*').eq('candidate_id', uid),
      supabase.from('candidate_languages').select('*').eq('candidate_id', uid), supabase.from('resumes').select('id,original_name,byte_size,scan_status,scan_detail,parse_status,active,created_at,storage_path').eq('candidate_id', uid).order('created_at', { ascending: false }),
      supabase.from('resume_extractions').select('*').eq('candidate_id', uid).eq('status', 'pending_review').maybeSingle()]);
    const profile = unwrap(p) as unknown as Profile; const prefs = unwrap(cl) ?? [];
    const [current, preferred] = await Promise.all([loadPlaces([profile.current_location_id]), loadPlaces(prefs.map((l) => l.location_id))]);
    return { profile, current: current[0] ?? null, preferred, skills: (unwrap(cs) ?? []).map((r) => r.skill_id), locations: prefs, education: unwrap(ed) ?? [], experience: unwrap(ex) ?? [], certs: unwrap(ce) ?? [], languages: unwrap(la) ?? [], resumes: unwrap(re) ?? [], extraction: unwrap(xt) };
  }, [uid]);
  const completion = useLoad(async () => unwrap(await supabase.rpc('my_profile_completion')) as { percent: number; missing: string[] }, []);
  const photo = useLoad(async () => { const path = bundle.data?.profile.photo_path; if (!path) return null; const { data } = await supabase.storage.from('profile-photos').createSignedUrl(path, 300); return data?.signedUrl ?? null; }, [bundle.data?.profile.photo_path]);

  const flags = usePlatformFlags();
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [form, setForm] = useState<{ headline: string; years: string; notice: string; expected: string; current: string; period: 'monthly' | 'annual'; status: string | null; modes: string[]; types: string[]; loc: Place | null; prefs: Place[]; skills: string[] } | null>(null);
  const [dirtyKey, setDirtyKey] = useState<unknown>(null);
  if (bundle.data && dirtyKey !== bundle.data) {
    const b = bundle.data; setDirtyKey(b);
    setForm({ headline: b.profile.headline ?? '', years: b.profile.experience_months ? String(b.profile.experience_months / 12) : '', notice: b.profile.notice_days?.toString() ?? '', expected: b.profile.salary_min?.toString() ?? '', current: b.profile.current_salary?.toString() ?? '',
      period: b.profile.salary_period, status: b.profile.employment_status, modes: b.profile.work_modes, types: b.profile.employment_types, loc: b.current, prefs: b.preferred, skills: b.skills });
  }
  const refresh = async () => { await Promise.all([bundle.reload(), completion.reload()]); };
  const bad = (e: { message?: string; code?: string }) => setMsg({ tone: 'error', text: e instanceof Error && !('code' in e) ? e.message : friendlyError(e) });
  const toggle = (list: string[], id: string, min = 0) => (list.includes(id) ? (list.length > min ? list.filter((x) => x !== id) : list) : [...list, id]);

  async function saveBasics() {
    if (!form) return;
    const years = num(form.years) ?? 0; const expected = num(form.expected); const current = num(form.current); const notice = num(form.notice);
    if (form.headline.length > 150) return setMsg({ tone: 'error', text: 'Headline must be 150 characters or fewer.' });
    if (years < 0 || years > 60) return setMsg({ tone: 'error', text: 'Enter experience between 0 and 60 years.' });
    if (notice !== null && (notice < 0 || notice > 365)) return setMsg({ tone: 'error', text: 'Notice period must be between 0 and 365 days.' });
    const { error } = await supabase.from('candidate_profiles').update({ headline: form.headline.trim() || null, experience_months: Math.round(years * 12), notice_days: notice, salary_min: expected, current_salary: current, salary_period: form.period,
      employment_status: form.status, work_modes: form.modes, employment_types: form.types, current_location_id: form.loc?.id ?? null, updated_at: new Date().toISOString() }).eq('user_id', uid);
    if (error) return bad(error);
    await supabase.from('candidate_locations').delete().eq('candidate_id', uid);
    if (form.prefs.length) { const { error: e2 } = await supabase.from('candidate_locations').insert(form.prefs.slice(0, 10).map((place, i) => ({ candidate_id: uid, location_id: place.id, preference_rank: i + 1 }))); if (e2) return bad(e2); }
    await refresh(); setMsg({ tone: 'success', text: 'Profile saved.' }); // only after the reload has reset the form
  }
  async function saveSkills() {
    if (!form) return;
    const have = bundle.data!.skills; const add = form.skills.filter((s) => !have.includes(s)); const drop = have.filter((s) => !form.skills.includes(s));
    if (add.length) { const { error } = await supabase.from('candidate_skills').upsert(add.map((skill_id) => ({ candidate_id: uid, skill_id, confirmed: true }))); if (error) return bad(error); }
    if (drop.length) { const { error } = await supabase.from('candidate_skills').delete().eq('candidate_id', uid).in('skill_id', drop); if (error) return bad(error); }
    await refresh(); setMsg({ tone: 'success', text: 'Skills saved.' }); // only after the reload has reset the form
  }
  async function upload(kind: 'resume' | 'photo') {
    try {
      const file = await pickFile(kind === 'resume' ? RESUME_TYPES : PHOTO_TYPES, kind === 'resume' ? MAX_RESUME_BYTES : MAX_PHOTO_BYTES); if (!file) return;
      if (kind === 'resume') { await uploadResume(uid, file); setMsg({ tone: 'success', text: 'Resume uploaded. It stays private and is checked before use.' }); }
      else {
        const path = `${uid}/${Date.now()}.${file.ext}`; const up = await supabase.storage.from('profile-photos').upload(path, file.bytes, { contentType: file.mime }); if (up.error) throw up.error;
        const { error } = await supabase.from('candidate_profiles').update({ photo_path: path }).eq('user_id', uid); if (error) throw error;
        const old = bundle.data?.profile.photo_path; if (old) await supabase.storage.from('profile-photos').remove([old]); setMsg({ tone: 'success', text: 'Photo updated.' });
      }
      await refresh();
    } catch (e) { bad(e as { message?: string }); }
  }
  const [delResume, setDelResume] = useState<any | null>(null);
  async function download(path: string) { try { await openWhenReady(() => resumeLink(path)); } catch (e) { bad(e as { message?: string }); } }

  const b = bundle.data;
  return <AppShell role="Candidate" title="Your profile" subtitle={completion.data ? `${completion.data.percent}% complete` : 'Keep it accurate for better matches'}>
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    <StateView loading={bundle.loading || taxonomy.loading || !form} error={bundle.error ?? taxonomy.error} onRetry={() => { void bundle.reload(); void taxonomy.reload(); }}>
      {b && form && taxonomy.data && <>
        {completion.data && completion.data.percent < 100 && <Banner tone="info">Still missing: {completion.data.missing.join(', ')}.</Banner>}
        <Card style={{ gap: 14 }}><SectionHead title="About you" />
          <Row><View style={styles.photo}>{photo.data ? <Image accessibilityLabel="Your profile photo" source={{ uri: photo.data }} style={styles.photoImg} /> : <Text style={styles.photoLetter}>{access?.display_name[0]}</Text>}</View><PrimaryButton label={photo.data ? 'Change photo' : 'Add photo (optional)'} variant="secondary" icon="camera-outline" onPress={() => upload('photo')} /></Row>
          <Field label="Professional headline" value={form.headline} onChangeText={(headline) => setForm({ ...form, headline })} placeholder="e.g. Customer success executive with 3 years in SaaS" maxLength={150} />
          <Chips label="Current status" options={statuses} selected={form.status ? [form.status] : []} onToggle={(s) => setForm({ ...form, status: s })} />
          <Row><Field label="Total experience (years)" value={form.years} onChangeText={(years) => setForm({ ...form, years })} keyboardType="decimal-pad" /><Field label="Notice period (days)" value={form.notice} onChangeText={(notice) => setForm({ ...form, notice })} keyboardType="number-pad" /></Row>
          <Chips label="Salary is quoted" options={[{ id: 'annual', label: 'Per year' }, { id: 'monthly', label: 'Per month' }]} selected={[form.period]} onToggle={(p) => setForm({ ...form, period: p as 'annual' | 'monthly' })} />
          <Row><Field label="Expected salary (₹)" value={form.expected} onChangeText={(expected) => setForm({ ...form, expected })} keyboardType="number-pad" /><Field label="Current salary (₹, optional, private)" value={form.current} onChangeText={(current) => setForm({ ...form, current })} keyboardType="number-pad" hint="Never shown to employers or used for matching." /></Row>
          <LocationPicker label="Where do you live now?" value={form.loc ? [form.loc] : []} onChange={(v) => setForm({ ...form, loc: v[0] ?? null })} kinds={['district', 'city', 'locality', 'pin']} placeholder="Type your city, area or PIN code" />
          <LocationPicker label="Where would you like to work? (in order of preference)" value={form.prefs} onChange={(prefs) => setForm({ ...form, prefs })} max={10} ranked
            hint="Add up to 10 places anywhere in India. Choose a whole state if you are open to any city in it. Your first choice counts most." />
          {form.prefs.length === 0 && <Text style={styles.muted}>No preferred locations yet.</Text>}
          <Chips label="Work mode I accept" options={modes} selected={form.modes} onToggle={(m) => setForm({ ...form, modes: toggle(form.modes, m, 1) })} />
          <Chips label="Employment types I accept" options={types} selected={form.types} onToggle={(m) => setForm({ ...form, types: toggle(form.types, m, 1) })} />
          <PrimaryButton label="Save profile" icon="save-outline" onPress={saveBasics} />
        </Card>
        <Card style={{ gap: 12 }}><SectionHead title="Skills" sub="Only skills you confirm are used for matching." />
          <Chips options={taxonomy.data.skills} selected={form.skills} onToggle={(s) => setForm({ ...form, skills: toggle(form.skills, s) })} /><PrimaryButton label="Save skills" icon="save-outline" onPress={saveSkills} /></Card>
        <Section title="Education" items={b.education} line={(e) => `${e.qualification}${e.field_of_study ? `, ${e.field_of_study}` : ''} · ${e.institution} · ${e.start_year ?? ''}–${e.end_year ?? 'present'}`} table="candidate_education" uid={uid} onChange={refresh} onError={bad}
          fields={[['institution', 'Institution'], ['qualification', 'Qualification'], ['field_of_study', 'Field of study (optional)'], ['start_year', 'Start year', 'int'], ['end_year', 'End year', 'int']]} />
        <Section title="Work experience" items={b.experience} line={(e) => `${e.title} · ${e.company_name} · ${e.start_date} to ${e.end_date ?? 'present'}`} table="candidate_experience" uid={uid} onChange={refresh} onError={bad}
          fields={[['title', 'Job title'], ['company_name', 'Company'], ['start_date', 'Start date (YYYY-MM-DD)', 'date'], ['end_date', 'End date (YYYY-MM-DD, blank if current)', 'date?'], ['description', 'What you did (optional)']]} />
        <Section title="Certifications" items={b.certs} line={(e) => `${e.name}${e.issuer ? ` · ${e.issuer}` : ''}${e.year ? ` · ${e.year}` : ''}`} table="candidate_certifications" uid={uid} onChange={refresh} onError={bad}
          fields={[['name', 'Certification'], ['issuer', 'Issuer (optional)'], ['year', 'Year (optional)', 'int']]} />
        <Card style={{ gap: 10 }}><SectionHead title="Languages" />{b.languages.map((l) => <Row key={l.language}><Text style={styles.line}>{l.language} · {labelize(l.proficiency)}</Text><PrimaryButton label="Remove" variant="ghost" onPress={async () => { const { error } = await supabase.from('candidate_languages').delete().eq('candidate_id', uid).eq('language', l.language); if (error) return bad(error); await refresh(); }} /></Row>)}
          <LanguageAdd uid={uid} onChange={refresh} onError={bad} /></Card>
        <Card style={{ gap: 12 }}><SectionHead title="Resume" sub="PDF or Word, up to 5 MB. Stored privately. When you apply, the employer can open your resume once it has passed security checks." />
          {b.resumes.filter((r) => r.active).map((r) => <View key={r.id} style={{ gap: 8 }}><Text style={styles.line}>{r.original_name} · {(r.byte_size / 1024).toFixed(0)} KB</Text>
            <ResumeStatus scan={r.scan_status} detail={r.scan_detail} parse={r.parse_status} />
            <Row><PrimaryButton label="Download" variant="secondary" icon="download-outline" disabled={r.scan_status !== 'clean'} onPress={() => download(r.storage_path)} /><PrimaryButton label="Delete" variant="ghost" icon="trash-outline" onPress={() => setDelResume(r)} /></Row></View>)}
          {b.resumes.filter((r) => !r.active && (r.scan_status === 'infected' || r.scan_status === 'failed')).slice(0, 1).map((r) => <Banner key={r.id} tone="error">Your last upload ({r.original_name}) was not accepted: {blockedReason(r.scan_detail, r.scan_status)}. Upload a different file.</Banner>)}
          {b.resumes.every((r) => !r.active) && <Text style={styles.muted}>No resume uploaded.</Text>}
          {flags?.resume_uploads_enabled
            ? <PrimaryButton label={b.resumes.some((r) => r.active) ? 'Replace resume' : 'Upload resume'} icon="cloud-upload-outline" onPress={() => upload('resume')} />
            : <Banner tone="info">{flags ? 'Resume upload is temporarily unavailable while we set up virus scanning for uploaded files. Your profile, job search and applications work without a resume.' : 'Checking resume upload availability…'}</Banner>}
          {b.extraction && <Card style={styles.review}><Text style={styles.line}>Suggested from your resume. Choose what to add:</Text><ExtractionReview extraction={b.extraction} onDone={refresh} onError={bad} /></Card>}
          <Text style={styles.muted}>Resume reading needs your permission in Settings. Nothing is added to your profile without your review.</Text></Card>
        <Card style={{ gap: 12 }}><SectionHead title="Preview" sub="What a verified employer sees if you enable discovery. Name, email, phone and resume are hidden." />
          <Text style={styles.previewTitle}>{b.profile.headline || 'Add a headline'}</Text>
          <Text style={styles.muted}>{b.current?.label ?? 'Location not set'} · {formatExperience(b.profile.experience_months)} experience · notice {b.profile.notice_days ?? '–'} days</Text>
          <Row>{b.skills.map((s) => <Pill key={s} tone="neutral">{taxonomy.data!.skills.find((x) => x.id === s)?.label ?? ''}</Pill>)}</Row>
          <Text style={styles.muted}>Expected: {b.profile.salary_min ? formatSalaryAmount(b.profile.salary_min, b.profile.salary_period) : 'not set'}</Text>
          <Row><Pill tone={b.profile.discovery_enabled ? 'teal' : 'neutral'}>{b.profile.discovery_enabled ? 'Discovery on' : 'Discovery off'}</Pill>
            <PrimaryButton label={b.profile.discovery_enabled ? 'Turn discovery off' : 'Turn discovery on'} variant="secondary" onPress={async () => { const { error } = await supabase.rpc('set_consent', { p_purpose: 'employer_discovery', p_granted: !b.profile.discovery_enabled, p_notice_version: NOTICE_VERSION }); if (error) return bad(error); setMsg({ tone: 'success', text: b.profile.discovery_enabled ? 'You are hidden from employer search.' : 'Verified employers can now find your masked profile.' }); await refresh(); }} /></Row></Card>
        <ConfirmDialog visible={!!delResume} destructive title="Delete this resume?" message="The file stops being available immediately and is permanently removed from private storage by our processing service. Applications already sent keep a record that you applied." confirmLabel="Delete resume" onCancel={() => setDelResume(null)}
          onConfirm={async () => { const r = delResume; setDelResume(null); const { error } = await supabase.rpc('delete_resume', { p_resume: r.id }); if (error) return bad(error); setMsg({ tone: 'success', text: 'Resume deleted.' }); await refresh(); }} />
      </>}
    </StateView>
  </AppShell>;
}

type FieldSpec = [string, string, ('int' | 'date' | 'date?')?];
function Section({ title, items, line, table, uid, fields, onChange, onError }: { title: string; items: any[]; line: (x: any) => string; table: string; uid: string; fields: FieldSpec[]; onChange: () => Promise<void>; onError: (e: any) => void }) {
  const [adding, setAdding] = useState(false); const [v, setV] = useState<Record<string, string>>({}); const [err, setErr] = useState<string | null>(null);
  async function save() {
    const row: Record<string, unknown> = { candidate_id: uid };
    for (const [key, label, kind] of fields) {
      const raw = (v[key] ?? '').trim();
      if (!raw) { if (!label.includes('optional') && !label.includes('blank') && kind !== 'date?') return setErr(`${label.replace(/ \(.*\)/, '')} is required.`); row[key] = null; continue; }
      if (kind === 'int') { if (!/^\d{4}$/.test(raw)) return setErr(`${label.replace(/ \(.*\)/, '')} must be a 4-digit year.`); row[key] = Number(raw); }
      else if (kind?.startsWith('date')) { if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) return setErr('Use the date format YYYY-MM-DD.'); row[key] = raw; }
      else row[key] = raw;
    }
    const { error } = await supabase.from(table).insert(row); if (error) { setErr(friendlyError(error)); return onError(error); }
    setAdding(false); setV({}); setErr(null); await onChange();
  }
  return <Card style={{ gap: 10 }}><SectionHead title={title} />
    {items.map((it) => <Row key={it.id}><Text style={styles.line}>{line(it)}</Text><PrimaryButton label="Remove" variant="ghost" onPress={async () => { const { error } = await supabase.from(table).delete().eq('id', it.id); if (error) return onError(error); await onChange(); }} /></Row>)}
    {items.length === 0 && <Text style={styles.muted}>Nothing added yet.</Text>}
    {adding ? <View style={{ gap: 10 }}>{fields.map(([key, label]) => <Field key={key} label={label} value={v[key] ?? ''} onChangeText={(t) => setV({ ...v, [key]: t })} />)}{err && <Banner tone="error">{err}</Banner>}<Row><PrimaryButton label="Save" onPress={save} /><PrimaryButton label="Cancel" variant="ghost" onPress={() => { setAdding(false); setErr(null); }} /></Row></View> : <PrimaryButton label={`Add ${title.toLowerCase()}`} variant="secondary" icon="add" onPress={() => setAdding(true)} />}
  </Card>;
}
function LanguageAdd({ uid, onChange, onError }: { uid: string; onChange: () => Promise<void>; onError: (e: any) => void }) {
  const [lang, setLang] = useState(''); const [level, setLevel] = useState('fluent');
  return <View style={{ gap: 10 }}><Field label="Language" value={lang} onChangeText={setLang} placeholder="e.g. Marathi" /><Chips options={levels} selected={[level]} onToggle={setLevel} />
    <PrimaryButton label="Add language" variant="secondary" icon="add" disabled={lang.trim().length < 2} onPress={async () => { const { error } = await supabase.from('candidate_languages').upsert({ candidate_id: uid, language: lang.trim(), proficiency: level }); if (error) return onError(error); setLang(''); await onChange(); }} /></View>;
}
function ExtractionReview({ extraction, onDone, onError }: { extraction: { resume_id: string; data: { skills?: string[]; headline?: string } }; onDone: () => Promise<void>; onError: (e: any) => void }) {
  const all = extraction.data.skills ?? []; const [sel, setSel] = useState<string[]>(all); const [headline, setHeadline] = useState(extraction.data.headline ?? '');
  return <View style={{ gap: 10 }}><Chips label="Skills found" options={all.map((s) => ({ id: s, label: s }))} selected={sel} onToggle={(s) => setSel(sel.includes(s) ? sel.filter((x) => x !== s) : [...sel, s])} /><Field label="Headline" value={headline} onChangeText={setHeadline} />
    <Row><PrimaryButton label="Add selected to my profile" onPress={async () => { const { error } = await supabase.rpc('accept_resume_extraction', { p_resume: extraction.resume_id, p_skills: sel, p_headline: headline || null }); if (error) return onError(error); await onDone(); }} /><PrimaryButton label="Dismiss" variant="ghost" onPress={async () => { await supabase.rpc('reject_resume_extraction', { p_resume: extraction.resume_id }); await onDone(); }} /></Row></View>;
}
const styles = StyleSheet.create({ muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 }, line: { color: colors.ink, fontSize: 15, flex: 1, minWidth: 200 }, photo: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.tealPale, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, photoImg: { width: 72, height: 72 }, photoLetter: { color: colors.tealDark, fontSize: 28, fontWeight: '900' }, review: { backgroundColor: '#FAFAFF', gap: 10 }, previewTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' } });

const reasons: Record<string, string> = {
  not_a_pdf: 'the file is not a real PDF', not_a_docx: 'the file is not a real Word document', truncated_pdf: 'the PDF is incomplete',
  pdf_javascript: 'the PDF contains scripts', pdf_launch_action: 'the PDF tries to open other programs', pdf_embedded_file: 'the PDF contains attached files',
  pdf_rich_media: 'the PDF contains embedded media', pdf_xfa_form: 'the PDF contains an interactive form', docx_macros: 'the document contains macros',
  docx_embedded_object: 'the document contains embedded objects', docx_executable_entry: 'the document contains a program file', archive_too_large: 'the file expands to an unsafe size',
  corrupt_archive: 'the file is damaged', size_mismatch: 'the upload did not complete', empty_file: 'the file is empty',
};
function blockedReason(detail: string | null, scan: string) {
  if (scan === 'infected') return 'our virus scanner flagged it';
  return (detail && reasons[detail]) || 'it could not be checked';
}
/** Explains exactly where the resume is in the security pipeline. Nothing here is shown as "done" before it is. */
function ResumeStatus({ scan, detail, parse }: { scan: string; detail: string | null; parse: string }) {
  if (scan === 'clean') return <Text style={styles.muted}>Security check: passed. {parse === 'pending' ? 'Reading suggestions…' : parse === 'skipped' ? 'Resume reading is off (Settings).' : parse === 'unavailable' ? 'Resume reading is not available yet.' : ''}</Text>;
  if (scan === 'pending') return <Banner tone="warn">Quarantined: this resume is waiting for a security scan{detail === 'awaiting_scanner' ? ' (the scanning service is not connected yet)' : ''}. Until it passes, you cannot download it and employers cannot see it. Your profile and applications still work.</Banner>;
  return <Banner tone="error">Not accepted: {blockedReason(detail, scan)}.</Banner>;
}

