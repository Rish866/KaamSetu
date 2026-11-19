import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../../components/AppShell';
import { Banner, Chips, ConfirmDialog, Field, Row, SectionHead, StateView, unwrap, useLoad } from '../../components/kit';
import { Card, Pill, PrimaryButton } from '../../components/ui';
import { useMembership } from '../../lib/company';
import { friendlyError, labelize } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../state/AuthContext';
import { colors } from '../../theme';

type Member = { user_id: string; display_name: string; email: string | null; role: string; active: boolean };
type Inv = { id: string; email: string; role: string; status: string; expires_at: string };
const roles = [['recruiter', 'Recruiter'], ['viewer', 'Viewer']].map(([id, label]) => ({ id, label }));
const sizes = ['1-10', '11-50', '51-200', '201-1000', '1000+'].map((id) => ({ id, label: id }));

export default function Team() {
  const { session } = useAuth(); const uid = session!.user.id; const membership = useMembership(uid); const m = membership.data; const owner = m?.role === 'owner';
  const team = useLoad(async () => m ? ((unwrap(await supabase.rpc('company_team', { p_company: m.company.id })) ?? []) as unknown as Member[]) : [], [m?.company.id]);
  const invs = useLoad(async () => m && owner ? ((unwrap(await supabase.from('company_invitations').select('id,email,role,status,expires_at').eq('company_id', m.company.id).eq('status', 'pending')) ?? []) as Inv[]) : [], [m?.company.id, owner]);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [email, setEmail] = useState(''); const [role, setRole] = useState('recruiter'); const [remove, setRemove] = useState<Member | null>(null);
  const [p, setP] = useState<Record<string, string> | null>(null);
  if (m && !p) setP({ display_name: m.company.display_name, website: m.company.website ?? '', description: m.company.description ?? '', city: m.company.city ?? '', industry: m.company.industry ?? '', company_size: m.company.company_size ?? '', registered_address: m.company.registered_address ?? '', operating_locations: (m.company.operating_locations ?? []).join(', ') });
  const bad = (e: { message?: string; code?: string }) => setMsg({ tone: 'error', text: friendlyError(e) });
  const identityLocked = Boolean(m && ['pending', 'approved', 'suspended'].includes(m.company.verification_status));
  async function run(fn: () => PromiseLike<{ error: { message?: string; code?: string } | null }>, ok: string) { const { error } = await fn(); if (error) return bad(error); setMsg({ tone: 'success', text: ok }); await Promise.all([team.reload(), invs.reload()]); }
  async function saveProfile() {
    if (!m || !p) return;
    if (p.website && !/^https?:\/\/\S+$/.test(p.website)) return setMsg({ tone: 'error', text: 'Website must start with http:// or https://' });
    const fields: Record<string, unknown> = { description: p.description, city: p.city, industry: p.industry, company_size: p.company_size,
      operating_locations: p.operating_locations.split(',').map((x) => x.trim()).filter(Boolean) };
    if (!identityLocked) Object.assign(fields, { display_name: p.display_name, website: p.website, registered_address: p.registered_address });
    const { error } = await supabase.rpc('update_company_profile', { p_company: m.company.id, p_fields: fields });
    if (error) return bad(error); setMsg({ tone: 'success', text: 'Company profile saved.' }); await membership.reload();
  }

  return <AppShell role="Employer" title="Company and team" subtitle={m ? `${m.company.legal_name} · ${labelize(m.company.verification_status)}` : ''}>
    {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    <StateView loading={membership.loading} error={membership.error} onRetry={membership.reload} empty={!m} emptyTitle="Create your company first">
      {m && p && <>
        <Card style={{ gap: 12 }}><SectionHead title="Company profile" sub="Shown to candidates on your jobs. The legal name is fixed after submission." />
          {identityLocked && <Text style={styles.muted}>Brand name, website and registered address are locked after you submit verification. Email support to change them.</Text>}
          <Field label="Public brand name" value={p.display_name} editable={owner && !identityLocked} onChangeText={(v) => setP({ ...p, display_name: v })} /><Field label="Website" value={p.website} editable={owner && !identityLocked} onChangeText={(v) => setP({ ...p, website: v })} autoCapitalize="none" />
          <Field label="About the company" value={p.description} editable={owner} onChangeText={(v) => setP({ ...p, description: v })} multiline maxLength={3000} />
          <Row><Field label="Industry" value={p.industry} editable={owner} onChangeText={(v) => setP({ ...p, industry: v })} /><Field label="Headquarters city" value={p.city} editable={owner} onChangeText={(v) => setP({ ...p, city: v })} /></Row>
          <Chips label="Company size" options={sizes} selected={p.company_size ? [p.company_size] : []} onToggle={(s) => owner && setP({ ...p, company_size: s })} />
          <Field label="Registered address" value={p.registered_address} editable={owner && !identityLocked} onChangeText={(v) => setP({ ...p, registered_address: v })} multiline /><Field label="Operating locations (comma separated)" value={p.operating_locations} editable={owner} onChangeText={(v) => setP({ ...p, operating_locations: v })} />
          {owner ? <PrimaryButton label="Save company profile" icon="save-outline" onPress={saveProfile} /> : <Text style={styles.muted}>Only owners can edit the company profile.</Text>}</Card>
        <SectionHead title="Team" />
        <StateView loading={team.loading} error={team.error} onRetry={team.reload}>
          {(team.data ?? []).map((t) => <Card key={t.user_id} style={styles.row}><View style={{ flex: 1 }}><Text style={styles.title}>{t.display_name}{t.user_id === uid ? ' (you)' : ''}</Text><Text style={styles.muted}>{t.email ?? ''}</Text></View><Pill tone={t.active ? 'teal' : 'neutral'}>{t.active ? labelize(t.role) : 'Deactivated'}</Pill>
            {owner && t.active && t.user_id !== uid && <><PrimaryButton label={t.role === 'owner' ? 'Make recruiter' : 'Make owner'} variant="secondary" onPress={() => run(() => supabase.rpc('set_member_role', { p_company: m.company.id, p_user: t.user_id, p_role: t.role === 'owner' ? 'recruiter' : 'owner' }), 'Role updated.')} />{t.role === 'recruiter' && <PrimaryButton label="Make viewer" variant="ghost" onPress={() => run(() => supabase.rpc('set_member_role', { p_company: m.company.id, p_user: t.user_id, p_role: 'viewer' }), 'Role updated.')} />}{t.role === 'viewer' && <PrimaryButton label="Make recruiter" variant="ghost" onPress={() => run(() => supabase.rpc('set_member_role', { p_company: m.company.id, p_user: t.user_id, p_role: 'recruiter' }), 'Role updated.')} />}<PrimaryButton label="Remove" variant="ghost" onPress={() => setRemove(t)} /></>}</Card>)}
        </StateView>
        {owner && <Card style={{ gap: 12 }}><SectionHead title="Invite a teammate" sub="They must register as an employer with this email and verify it before accepting." />
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" /><Chips options={roles} selected={[role]} onToggle={setRole} />
          <PrimaryButton label="Send invitation" icon="mail-outline" disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)} onPress={async () => { await run(() => supabase.rpc('invite_company_member', { p_company: m.company.id, p_email: email, p_role: role }), 'Invitation created. Ask your teammate to sign up with that email and open KaamSetu.'); setEmail(''); }} />
          {(invs.data ?? []).map((i) => <Row key={i.id}><Text style={styles.muted}>{i.email} · {labelize(i.role)} · expires {new Date(i.expires_at).toLocaleDateString('en-IN')}</Text><PrimaryButton label="Revoke" variant="ghost" onPress={() => run(() => supabase.rpc('revoke_company_invitation', { p_invitation: i.id }), 'Invitation revoked.')} /></Row>)}</Card>}
      </>}
    </StateView>
    <ConfirmDialog visible={!!remove} destructive title={`Remove ${remove?.display_name}?`} message="They immediately lose access to this company's jobs and applicants." confirmLabel="Remove member" onCancel={() => setRemove(null)} onConfirm={async () => { const t = remove!; setRemove(null); await run(() => supabase.rpc('deactivate_member', { p_company: m!.company.id, p_user: t.user_id }), 'Member removed.'); }} />
  </AppShell>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }, title: { color: colors.ink, fontSize: 16, fontWeight: '900' }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 } });
