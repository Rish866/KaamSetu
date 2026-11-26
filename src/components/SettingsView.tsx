import { router } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { AppShell } from './AppShell';
import { Banner, ConfirmDialog, Field, Row, SectionHead, StateView, unwrap, useLoad } from './kit';
import { Card, PrimaryButton } from './ui';
import { NOTICE_VERSION, PRIVACY_EMAIL } from '../content/legal';
import { friendlyError } from '../lib/format';
import { validatePassword } from '../lib/password';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/AuthContext';
import { colors } from '../theme';

const purposes: { id: string; title: string; text: string }[] = [
  { id: 'employer_discovery', title: 'Let verified employers discover me', text: 'Employers see a masked profile: skills, experience, city and expected salary. Never your name, email, phone or resume.' },
  { id: 'contact_sharing', title: 'Share my email and phone after I am shortlisted', text: 'Only employers who shortlisted you can see them, and each disclosure is logged for you.' },
  { id: 'resume_parsing', title: 'Read my resume to suggest profile details', text: 'Suggestions are never added until you review and accept them.' },
  { id: 'joining_verification', title: 'Confirm my joining with employers who hire me', text: 'Needed to accept an offer. KaamSetu records your joining and day-15/day-30 status and confirms them with that employer. Turning this off stops new records; earlier ones stay.' },
  { id: 'marketing', title: 'Send me tips and product news by email', text: 'Optional. Off unless you turn it on. Essential account and application emails are always sent.' },
];
type Consent = { purpose: string; action: string; notice_version: string; created_at: string };

export function SettingsView({ role }: { role: 'Candidate' | 'Employer' }) {
  const shown = role === 'Candidate' ? purposes : purposes.filter((p) => p.id === 'marketing');
  const { access, session, signOut } = useAuth();
  const consents = useLoad(async () => (unwrap(await supabase.from('consent_records').select('purpose,action,notice_version,created_at').order('created_at', { ascending: false }).order('id', { ascending: false })) ?? []) as Consent[], []);
  const prefs = useLoad(async () => (unwrap(await supabase.from('notification_preferences').select('email_updates').maybeSingle()) as { email_updates: boolean } | null)?.email_updates ?? true, []);
  const requests = useLoad(async () => (unwrap(await supabase.from('privacy_requests').select('id,kind,status,created_at').order('created_at', { ascending: false }).limit(10)) ?? []) as { id: string; kind: string; status: string; created_at: string }[], []);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [current, setCurrent] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [email, setEmail] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false); const [confirmAll, setConfirmAll] = useState(false);
  const ok = (text: string) => setMsg({ tone: 'success', text }); const bad = (e: { message?: string; code?: string }) => setMsg({ tone: 'error', text: friendlyError(e) });
  const granted = (p: string) => (consents.data ?? []).find((c) => c.purpose === p)?.action === 'granted';

  async function setConsent(purpose: string, value: boolean) {
    const { error } = await supabase.rpc('set_consent', { p_purpose: purpose, p_granted: value, p_notice_version: NOTICE_VERSION });
    if (error) return bad(error); await consents.reload(); ok(value ? 'Saved. You can withdraw this at any time.' : 'Withdrawn. This takes effect immediately.');
  }
  async function changePassword() {
    const problem = validatePassword(pw); if (problem) return setMsg({ tone: 'error', text: problem });
    if (pw !== pw2) return setMsg({ tone: 'error', text: 'The two passwords do not match.' });
    // Re-authenticate with the current password first, so a borrowed unlocked device cannot change it.
    const user = session?.user; if (!user || !current) return setMsg({ tone: 'error', text: 'Enter your current password.' });
    const check = user.email ? await supabase.auth.signInWithPassword({ email: user.email, password: current }) : await supabase.auth.signInWithPassword({ phone: user.phone ?? '', password: current });
    if (check.error) return setMsg({ tone: 'error', text: 'Your current password is incorrect.' });
    const { error } = await supabase.auth.updateUser({ password: pw }); if (error) return bad(error); setCurrent(''); setPw(''); setPw2(''); ok('Password changed. A security notice was added to your notifications.');
  }
  async function changeEmail() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setMsg({ tone: 'error', text: 'Enter a valid email address.' });
    const { error } = await supabase.auth.updateUser({ email: email.trim().toLowerCase() }); if (error) return bad(error); ok('Check both your old and new inbox to confirm the change.');
  }
  async function exportData() {
    const { data, error } = await supabase.rpc('request_data_export'); if (error) return bad(error);
    const text = JSON.stringify(data, null, 2);
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a');
      a.href = url; a.download = `kaamsetu-my-data-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
    } else await Share.share({ message: text, title: 'My KaamSetu data' });
    ok('Your data export was generated.'); await requests.reload();
  }
  async function localSignOut() { await signOut(); router.replace('/login'); }
  async function globalSignOut() { await supabase.auth.signOut({ scope: 'global' }); await signOut(); router.replace('/login'); }
  const openDeletion = (requests.data ?? []).find((r) => r.kind === 'deletion' && r.status === 'requested');

  return <AppShell role={role} title="Settings" subtitle="Your privacy, consents and security">
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    <SectionHead title="Privacy choices" sub={`Notice version ${NOTICE_VERSION}. Each choice is recorded and can be withdrawn.`} />
    <StateView loading={consents.loading} error={consents.error} onRetry={consents.reload}>
      <Card style={{ gap: 4 }}>{shown.map((p) => <View key={p.id} style={styles.consent}><View style={{ flex: 1 }}><Text style={styles.title}>{p.title}</Text><Text style={styles.muted}>{p.text}</Text></View>
        <PrimaryButton label={granted(p.id) ? 'On · Turn off' : 'Off · Turn on'} variant={granted(p.id) ? 'primary' : 'secondary'} onPress={() => setConsent(p.id, !granted(p.id))} /></View>)}</Card>
      <Card style={{ gap: 6 }}><Text style={styles.title}>Consent history</Text>{(consents.data ?? []).slice(0, 12).map((c, i) => <Text key={i} style={styles.muted}>{new Date(c.created_at).toLocaleString('en-IN')} · {c.purpose.replace(/_/g, ' ')} · {c.action}</Text>)}</Card>
    </StateView>
    <SectionHead title="Email" />
    <Card style={{ gap: 10 }}><View style={styles.consent}><View style={{ flex: 1 }}><Text style={styles.title}>Optional update emails</Text><Text style={styles.muted}>Optional: application viewed, interview confirmations and other non-urgent updates. Security emails and messages about shortlisting, interviews, offers and decisions are always sent. In-app notifications are unaffected.</Text></View>
      <PrimaryButton label={prefs.data === false ? 'Off · Turn on' : 'On · Turn off'} variant="secondary" onPress={async () => { const { error } = await supabase.rpc('set_notification_preferences', { p_email_updates: prefs.data === false }); if (error) return bad(error); await prefs.reload(); ok('Email preference saved.'); }} /></View></Card>
    <SectionHead title="Account security" />
    <Card style={{ gap: 12 }}>
      <Text style={styles.muted}>Signed in as {session?.user.email ?? session?.user.phone ?? access?.display_name}.</Text>
      <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
      <Row><Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" hint="At least 10 characters with upper case, lower case and a number." /><Field label="Repeat new password" value={pw2} onChangeText={setPw2} secureTextEntry autoComplete="new-password" /></Row>
      <PrimaryButton label="Change password" icon="key-outline" onPress={changePassword} />
      <Field label="Change email address" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" hint="We email a confirmation link to both addresses." /><PrimaryButton label="Send confirmation link" variant="secondary" onPress={changeEmail} />
      <Banner tone="warn">Accounts that use only a mobile number cannot recover a forgotten password until SMS delivery is switched on. Add an email address to your account so you can always reset your password.</Banner>
      <Row><PrimaryButton label="Sign out of this device" variant="secondary" onPress={localSignOut} /><PrimaryButton label="Sign out of all devices" variant="secondary" onPress={() => setConfirmAll(true)} /></Row>
    </Card>
    <SectionHead title="Your data" />
    <Card style={{ gap: 12 }}>
      <Text style={styles.muted}>Download your account, profile, applications, invitations, consents and disclosures as a JSON file, or ask us to delete your account. Resume files are not included in the export; download them from your profile. Deleting removes your profile, resume and skills; consent and security records may be kept as required by law.</Text>
      <Row><PrimaryButton label="Download my data" icon="download-outline" onPress={exportData} />
        {openDeletion ? <PrimaryButton label="Cancel deletion request" variant="secondary" onPress={async () => { const { error } = await supabase.rpc('cancel_privacy_request', { p_request: openDeletion.id }); if (error) return bad(error); await requests.reload(); ok('Deletion request cancelled.'); }} /> : <PrimaryButton label="Request account deletion" variant="secondary" icon="trash-outline" onPress={() => setConfirmDelete(true)} />}</Row>
      {openDeletion && <Banner tone="warn">Deletion requested on {new Date(openDeletion.created_at).toLocaleDateString('en-IN')}. Our privacy team will process it after confirming it is you. You can cancel until then. We send a final confirmation to your current email address.</Banner>}
      <Text style={styles.muted}>Privacy questions: <Text style={{ color: colors.teal }} onPress={() => Linking.openURL(`mailto:${PRIVACY_EMAIL}`)}>{PRIVACY_EMAIL}</Text></Text>
    </Card>
    <ConfirmDialog visible={confirmDelete} destructive title="Request account deletion?" message="Your profile, skills and resume will be removed once our privacy team processes the request. Active applications are withdrawn. This cannot be undone after processing." confirmLabel="Request deletion" onCancel={() => setConfirmDelete(false)} onConfirm={async () => { setConfirmDelete(false); const { error } = await supabase.rpc('request_account_deletion'); if (error) return bad(error); await requests.reload(); ok('Deletion requested.'); }} />
    <ConfirmDialog visible={confirmAll} title="Sign out everywhere?" message="You will need to sign in again on every device." confirmLabel="Sign out of all devices" onCancel={() => setConfirmAll(false)} onConfirm={globalSignOut} />
  </AppShell>;
}
const styles = StyleSheet.create({ consent: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 12, flexWrap: 'wrap' }, title: { color: colors.ink, fontWeight: '800', fontSize: 15 }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 } });
