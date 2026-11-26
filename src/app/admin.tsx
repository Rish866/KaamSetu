import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppShell } from '../components/AppShell';
import { Banner, Chips, ConfirmDialog, Field, Row, SectionHead, StateView, unwrap, useLoad } from '../components/kit';
import { AdminLedger } from '../components/HiringLedger';
import { Card, Metric, Pill, PrimaryButton } from '../components/ui';
import { openWhenReady } from '../lib/files';
import { formatSalaryRange, friendlyError, labelize, timeAgo } from '../lib/format';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

type Dash = Record<string, number> & { roles: string[] };
const tabDefs: { id: string; label: string; roles: string[] }[] = [
  { id: 'overview', label: 'Overview', roles: ['admin', 'moderator', 'support', 'privacy'] }, { id: 'companies', label: 'Companies', roles: ['admin', 'moderator'] },
  { id: 'jobs', label: 'Jobs', roles: ['admin', 'moderator'] }, { id: 'reports', label: 'Reports', roles: ['admin', 'moderator', 'support'] }, { id: 'hiring', label: 'Hiring disputes', roles: ['admin', 'moderator'] }, { id: 'fees', label: 'Hiring fees', roles: ['admin'] },
  { id: 'users', label: 'Users', roles: ['admin', 'support', 'privacy'] }, { id: 'privacy', label: 'Privacy', roles: ['admin', 'privacy'] },
  { id: 'audit', label: 'Audit', roles: ['admin', 'privacy'] }, { id: 'system', label: 'System', roles: ['admin', 'support'] }, { id: 'access', label: 'Access & matching', roles: ['admin'] },
];
type Act = { title: string; message?: string; confirm: string; run: (reason: string) => PromiseLike<{ error: { message?: string; code?: string } | null }>; destructive?: boolean };

export default function AdminScreen() {
  const dash = useLoad(async () => unwrap(await supabase.rpc('admin_dashboard')) as unknown as Dash, []);
  const [tab, setTab] = useState('overview'); const [act, setAct] = useState<Act | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null); const [tick, setTick] = useState(0);
  const roles = dash.data?.roles ?? []; const visible = tabDefs.filter((t) => t.roles.some((r) => roles.includes(r)));
  const ask = (a: Act) => setAct(a);
  const props = { ask, tick, setMsg };
  return <AppShell role={`Admin · ${roles.join(', ') || '…'}`} title="Trust & safety console" subtitle="Every action needs a reason and is written to the immutable audit log">
    <StateView loading={dash.loading} error={dash.error} onRetry={dash.reload}>
      <Chips options={visible.map((t) => ({ id: t.id, label: t.label }))} selected={[tab]} onToggle={setTab} />
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {tab === 'overview' && dash.data && <Overview d={dash.data} go={setTab} />}
      {tab === 'companies' && <Companies {...props} />}{tab === 'jobs' && <Jobs {...props} />}{tab === 'reports' && <Reports {...props} />}{tab === 'hiring' && <HiringDisputes {...props} />}{tab === 'fees' && <AdminLedger tick={tick} />}
      {tab === 'users' && <Users {...props} />}{tab === 'privacy' && <PrivacyQueue {...props} />}{tab === 'audit' && <Audit />}{tab === 'system' && <System {...props} />}{tab === 'access' && <Access {...props} />}
    </StateView>
    <ConfirmDialog visible={!!act} requireReason destructive={act?.destructive} title={act?.title ?? ''} message={act?.message} confirmLabel={act?.confirm ?? 'Confirm'} onCancel={() => setAct(null)}
      onConfirm={async (reason) => { const a = act!; const { error } = await a.run(reason); if (error) throw error; setAct(null); setMsg({ tone: 'success', text: 'Done. The action was recorded in the audit log.' }); setTick((t) => t + 1); void dash.reload(); }} />
  </AppShell>;
}
type P = { ask: (a: Act) => void; tick: number; setMsg: (m: { tone: 'error' | 'success'; text: string }) => void };

function Overview({ d, go }: { d: Dash; go: (t: string) => void }) {
  const q: [string, number, string, string][] = [['Companies to verify', d.companies_pending, 'companies', 'business-outline'], ['Jobs to review', d.jobs_pending, 'jobs', 'document-text-outline'], ['Open reports', d.reports_open, 'reports', 'flag-outline'], ['Privacy requests', d.privacy_open, 'privacy', 'finger-print-outline'], ['Deletion clean-up pending', d.privacy_cleanup_pending, 'privacy', 'trash-outline'], ['Emails waiting to send', d.email_pending, 'system', 'mail-unread-outline'], ['Failed emails', d.email_failures, 'system', 'mail-outline'], ['Resumes in quarantine', d.resumes_quarantined, 'system', 'shield-outline']];
  return <><View style={styles.metrics}>{q.map(([label, v, t, icon]) => <View key={label} style={{ flexGrow: 1, minWidth: 150 }}><Metric label={label} value={`${v}`} icon={icon as never} /><PrimaryButton label="Open" variant="ghost" onPress={() => go(t)} /></View>)}</View>
    <SectionHead title="Platform" /><View style={styles.metrics}><Metric label="Active candidates" value={`${d.candidates}`} icon="person-outline" /><Metric label="Active employers" value={`${d.employers}`} icon="business-outline" /><Metric label="Published jobs" value={`${d.published_jobs}`} icon="briefcase-outline" /><Metric label="Applications" value={`${d.applications}`} icon="paper-plane-outline" /><Metric label="Audit events (24h)" value={`${d.audit_events_24h}`} icon="list-outline" /></View></>;
}

function Companies({ ask, tick, setMsg }: P) {
  const [status, setStatus] = useState('pending');
  const q = useLoad(async () => (unwrap(await supabase.rpc('admin_company_queue', { p_status: status })) ?? []) as any[], [status, tick]);
  async function evidence(path: string) { try { await openWhenReady(async () => { const { data, error } = await supabase.storage.from('company-evidence').createSignedUrl(path, 60); if (error || !data) throw error ?? new Error('Could not open the document.'); return data.signedUrl; }); } catch (e) { setMsg({ tone: 'error', text: friendlyError(e as { message?: string }) }); } }
  const decide = (c: any, decision: string, title: string, confirm: string, destructive = false) => ask({ title: `${title}: ${c.display_name}`, confirm, destructive, run: (reason) => supabase.rpc('admin_review_company', { p_company: c.company_id, p_decision: decision, p_reason: reason }) });
  return <><Chips label="Status" options={['pending', 'approved', 'rejected', 'draft', 'suspended'].map((s) => ({ id: s, label: labelize(s) }))} selected={[status]} onToggle={setStatus} />
    <StateView loading={q.loading} error={q.error} onRetry={q.reload} empty={(q.data ?? []).length === 0} emptyTitle="Queue is empty">{(q.data ?? []).map((c) => <Card key={c.company_id} style={{ gap: 8 }}>
      <Text style={styles.title}>{c.display_name} <Text style={styles.muted}>({c.legal_name})</Text></Text><Text style={styles.muted}>{c.city ?? '–'} · {c.website ?? 'no website'} · {c.industry ?? 'industry n/a'} · {c.company_size ?? 'size n/a'}</Text><Text style={styles.muted}>Owner: {c.owner_name} ({c.owner_email}) · Address: {c.registered_address ?? 'n/a'}</Text>
      <Text style={styles.body}>{c.identifier_type ? `${String(c.identifier_type).toUpperCase()}: ${c.identifier_value}` : 'No identifier submitted'}{c.submitted_at ? ` · submitted ${timeAgo(c.submitted_at)}` : ''}</Text>{c.reason && <Text style={styles.muted}>Last note: {c.reason}</Text>}
      <Row>{c.evidence_path && <PrimaryButton label="Open evidence" variant="secondary" icon="document-text-outline" onPress={() => evidence(c.evidence_path)} />}
        {c.status === 'pending' && <><PrimaryButton label="Approve" icon="checkmark-circle-outline" onPress={() => decide(c, 'approve', 'Approve company', 'Approve')} /><PrimaryButton label="Request more info" variant="secondary" onPress={() => decide(c, 'request_info', 'Ask for more information', 'Send request')} /><PrimaryButton label="Reject" variant="secondary" onPress={() => decide(c, 'reject', 'Reject company', 'Reject', true)} /></>}
        {c.status === 'approved' && <PrimaryButton label="Suspend" variant="secondary" onPress={() => decide(c, 'suspend', 'Suspend company and pause its jobs', 'Suspend', true)} />}{c.status === 'suspended' && <PrimaryButton label="Restore" onPress={() => decide(c, 'restore', 'Restore company', 'Restore')} />}</Row></Card>)}</StateView></>;
}

function Jobs({ ask, tick }: P) {
  const [status, setStatus] = useState('pending_review');
  const q = useLoad(async () => (unwrap(await supabase.rpc('admin_job_queue', { p_status: status })) ?? []) as any[], [status, tick]);
  const decide = (j: any, decision: string, title: string, confirm: string, destructive = false) => ask({ title: `${title}: ${j.title}`, confirm, destructive, run: (reason) => supabase.rpc('admin_review_job', { p_job: j.job_id, p_decision: decision, p_reason: reason }) });
  return <><Chips label="Status" options={['pending_review', 'published', 'paused', 'closed', 'rejected'].map((s) => ({ id: s, label: labelize(s) }))} selected={[status]} onToggle={setStatus} />
    <StateView loading={q.loading} error={q.error} onRetry={q.reload} empty={(q.data ?? []).length === 0} emptyTitle="No jobs in this state">{(q.data ?? []).map((j) => <Card key={j.job_id} style={{ gap: 8 }}>
      <Text style={styles.title}>{j.title}{j.moderation_hold ? ' · on hold' : ''}</Text><Text style={styles.muted}>{j.company_name} ({labelize(j.company_status)}) · {labelize(j.work_mode)}{j.city ? ` · ${j.city}` : ''} · {formatSalaryRange(j.salary_min, j.salary_max, j.salary_period)}</Text>
      <Text style={styles.body}>{j.description}</Text><Row>{(j.skills ?? []).map((s: string) => <Pill key={s} tone="neutral">{s}</Pill>)}</Row>
      <Row>{status === 'pending_review' && <><PrimaryButton label="Approve and publish" icon="checkmark-circle-outline" onPress={() => decide(j, 'approve', 'Approve job', 'Publish')} /><PrimaryButton label="Reject" variant="secondary" onPress={() => decide(j, 'reject', 'Reject job', 'Reject', true)} /></>}
        {status === 'published' && <PrimaryButton label="Pause" variant="secondary" onPress={() => decide(j, 'pause', 'Pause job', 'Pause')} />}
        {j.moderation_hold === 'admin' && (status === 'paused' || status === 'closed') && <PrimaryButton label="Lift moderation hold" variant="secondary" onPress={() => decide(j, 'reinstate', 'Lift hold so the employer can resume this job', 'Lift hold')} />}{['pending_review', 'published', 'paused'].includes(status) && <PrimaryButton label="Remove" variant="ghost" onPress={() => decide(j, 'remove', 'Remove job permanently from listings', 'Remove', true)} />}</Row></Card>)}</StateView></>;
}

function Reports({ ask, tick }: P) {
  const [status, setStatus] = useState('open');
  const q = useLoad(async () => (unwrap(await supabase.rpc('admin_reports', { p_status: status })) ?? []) as any[], [status, tick]);
  const resolve = (r: any, to: string, title: string) => ask({ title, confirm: 'Save', run: (reason) => supabase.rpc('admin_resolve_report', { p_report: r.report_id, p_status: to, p_reason: reason }) });
  return <><Chips label="Status" options={['open', 'reviewing', 'actioned', 'dismissed'].map((s) => ({ id: s, label: labelize(s) }))} selected={[status]} onToggle={setStatus} />
    <StateView loading={q.loading} error={q.error} onRetry={q.reload} empty={(q.data ?? []).length === 0} emptyTitle="No reports">{(q.data ?? []).map((r) => <Card key={r.report_id} style={{ gap: 8 }}>
      <Text style={styles.title}>{labelize(r.category)} · {r.job_title ?? 'job removed'} <Text style={styles.muted}>({r.company_name ?? 'company n/a'})</Text></Text><Text style={styles.body}>{r.details ?? 'No details provided.'}</Text><Text style={styles.muted}>Reported {timeAgo(r.created_at)}{r.resolution ? ` · ${r.resolution}` : ''}</Text>
      {(status === 'open' || status === 'reviewing') && <Row>{status === 'open' && <PrimaryButton label="Start review" variant="secondary" onPress={() => resolve(r, 'reviewing', 'Start reviewing this report')} />}<PrimaryButton label="Action taken" onPress={() => resolve(r, 'actioned', 'Mark as actioned')} /><PrimaryButton label="Dismiss" variant="ghost" onPress={() => resolve(r, 'dismissed', 'Dismiss report')} /></Row>}</Card>)}</StateView></>;
}

function HiringDisputes({ ask, tick }: P) {
  const q = useLoad(async () => (unwrap(await supabase.rpc('admin_hiring_disputes')) ?? []) as any[], [tick]);
  const decide = (r: any, decision: 'confirm' | 'reject', title: string) => ask({ title, confirm: 'Save decision', message: 'Both sides are notified and see your reason.',
    run: (reason) => supabase.rpc('admin_resolve_hiring_milestone', { p_milestone: r.milestone_id, p_decision: decision, p_reason: reason }) });
  return <StateView loading={q.loading} error={q.error} onRetry={q.reload} empty={(q.data ?? []).length === 0} emptyTitle="No disputed milestones">{(q.data ?? []).map((r) => <Card key={r.milestone_id} style={{ gap: 8 }}>
    <Text style={styles.title}>{r.label} · {r.job_title} <Text style={styles.muted}>({r.company_name})</Text></Text>
    <Text style={styles.body}>Reported by the {r.reported_role} for {new Date(`${r.occurred_on}T00:00:00`).toLocaleDateString('en-IN')}{r.note ? `: ${r.note}` : ''}</Text>
    <Text style={styles.body}>Dispute: {r.dispute_reason}</Text><Text style={styles.muted}>Disputed {timeAgo(r.disputed_at)}</Text>
    <Row><PrimaryButton label="It happened" onPress={() => decide(r, 'confirm', `Confirm: ${r.label}`)} /><PrimaryButton label="It did not happen" variant="secondary" onPress={() => decide(r, 'reject', `Reject: ${r.label}`)} /></Row>
  </Card>)}</StateView>;
}

function Users({ ask, tick }: P) {
  const [text, setText] = useState(''); const [applied, setApplied] = useState('');
  const q = useLoad(async () => (applied.trim().length < 3 ? null : (unwrap(await supabase.rpc('admin_find_user', { p_query: applied })) ?? [])) as any[] | null, [applied, tick]);
  const rows = q.data;
  return <><Card style={{ gap: 10 }}><Field label="Find a user by email, phone or name" value={text} onChangeText={setText} hint="Lookups are recorded in the audit log. Resumes and candidate profiles are not available here." /><PrimaryButton label="Search" icon="search" disabled={text.trim().length < 3} onPress={() => setApplied(text.trim())} /></Card>
    <StateView loading={q.loading} error={q.error} onRetry={q.reload}>{rows?.length === 0 && <Banner>No users found.</Banner>}
    {rows?.map((u) => <Card key={u.user_id} style={{ gap: 8 }}><Text style={styles.title}>{u.display_name} <Pill tone={u.status === 'active' ? 'teal' : 'coral'}>{labelize(u.status)}</Pill></Text><Text style={styles.muted}>{u.email ?? 'no email'} · {u.phone ?? 'no phone'} · {labelize(u.account_kind)} · joined {timeAgo(u.created_at)}{u.roles.length ? ` · roles: ${u.roles.join(', ')}` : ''}</Text><Text style={styles.muted}>User ID: {u.user_id}</Text>
      <Row>{u.status === 'active' ? <PrimaryButton label="Suspend account" variant="secondary" onPress={() => ask({ title: `Suspend ${u.display_name}`, message: 'They are signed out of all actions immediately.', confirm: 'Suspend', destructive: true, run: (r) => supabase.rpc('admin_set_account_status', { p_user: u.user_id, p_status: 'suspended', p_reason: r }) })} /> : u.status === 'suspended' ? <PrimaryButton label="Restore account" onPress={() => ask({ title: `Restore ${u.display_name}`, confirm: 'Restore', run: (r) => supabase.rpc('admin_set_account_status', { p_user: u.user_id, p_status: 'active', p_reason: r }) })} /> : null}</Row></Card>)}</StateView></>;
}

function PrivacyQueue({ ask, tick }: P) {
  const q = useLoad(async () => (unwrap(await supabase.rpc('admin_privacy_queue')) ?? []) as any[], [tick]);
  const [done, setDone] = useState<string | null>(null);
  return <><Banner>Deletion anonymises the profile and removes personal data. Stored files and the sign-in identity are removed afterwards by the trusted privacy worker (counted under Deletion clean-up pending on the overview). Data exports are generated instantly by the account holder.</Banner>{done && <Banner tone="success">{done}</Banner>}
    <StateView loading={q.loading} error={q.error} onRetry={q.reload} empty={(q.data ?? []).length === 0} emptyTitle="No open deletion requests">{(q.data ?? []).map((r) => <Card key={r.request_id} style={{ gap: 8 }}><Text style={styles.title}>{r.display_name} · account deletion</Text><Text style={styles.muted}>Requested {timeAgo(r.created_at)}. Confirm the identity of the requester before processing.</Text>
      <Row><PrimaryButton label="Process deletion" icon="trash-outline" onPress={() => ask({ title: `Delete account of ${r.display_name}`, message: 'This permanently removes their profile data. It cannot be undone.', confirm: 'Delete account', destructive: true, run: async (reason) => { const res = await supabase.rpc('admin_process_deletion', { p_request: r.request_id, p_reason: reason }); if (!res.error) setDone(`Processed. ${((res.data as any)?.storage_paths_to_purge ?? []).length} stored file(s) are queued for purge.`); return res; } })} />
        <PrimaryButton label="Reject request" variant="secondary" onPress={() => ask({ title: 'Reject deletion request', confirm: 'Reject', run: (reason) => supabase.rpc('admin_reject_privacy_request', { p_request: r.request_id, p_reason: reason }) })} /></Row></Card>)}</StateView></>;
}

function Audit() {
  const [f, setF] = useState({ action: '', target: '' }); const [applied, setApplied] = useState(f);
  const q = useLoad(async () => (unwrap(await supabase.rpc('admin_search_audit', { p_action: applied.action || null, p_target_type: applied.target || null, p_limit: 100 })) ?? []) as any[], [applied]);
  return <><Card style={{ gap: 10 }}><Row><Field label="Action starts with" value={f.action} onChangeText={(action) => setF({ ...f, action })} placeholder="e.g. company." autoCapitalize="none" /><Field label="Target type" value={f.target} onChangeText={(target) => setF({ ...f, target })} placeholder="e.g. job" autoCapitalize="none" /></Row><PrimaryButton label="Search audit log" icon="search" onPress={() => setApplied(f)} /></Card>
    <StateView loading={q.loading} error={q.error} onRetry={q.reload} empty={(q.data ?? []).length === 0} emptyTitle="No matching events">{(q.data ?? []).map((e) => <Card key={e.id} style={{ gap: 3, padding: 14 }}><Text style={styles.title}>{e.action}</Text><Text style={styles.muted}>{new Date(e.created_at).toLocaleString('en-IN')} · by {e.actor_name ?? 'system'} · {e.target_type}</Text>{Object.keys(e.metadata ?? {}).length > 0 && <Text style={styles.muted}>{JSON.stringify(e.metadata)}</Text>}</Card>)}</StateView></>;
}

function System({ ask, tick }: P) {
  const status = useLoad(async () => unwrap(await supabase.rpc('admin_email_status')) as { by_status: Record<string, number>; oldest_pending_minutes: number | null; last_sent_at: string | null }, [tick]);
  const q = useLoad(async () => (unwrap(await supabase.rpc('admin_email_failures')) ?? []) as any[], [tick]);
  const resumes = useLoad(async () => (unwrap(await supabase.rpc('admin_resume_queue')) ?? []) as any[], [tick]);
  const flags = useLoad(async () => unwrap(await supabase.rpc('platform_flags')) as unknown as { resume_uploads_enabled: boolean }, [tick]);
  const s = status.data;
  return <>
    <SectionHead title="Email delivery" sub="Messages stay queued until an email provider is connected and the worker runs. Nothing is marked sent unless the provider accepted it." />
    <StateView loading={status.loading} error={status.error} onRetry={status.reload}>{s && <Card style={{ gap: 6 }}>
      <Text style={styles.body}>{Object.entries(s.by_status).map(([k, v]) => `${labelize(k)}: ${v}`).join(' · ') || 'No email has been queued yet.'}</Text>
      <Text style={styles.muted}>Oldest waiting: {s.oldest_pending_minutes === null ? 'none' : `${s.oldest_pending_minutes} min`} · Last delivered: {s.last_sent_at ? timeAgo(s.last_sent_at) : 'never'}</Text>
      {(s.by_status.pending ?? 0) > 0 && !s.last_sent_at && <Banner tone="warn">Emails are queued but none has ever been delivered. The email provider is probably not connected yet (see docs/OWNER_ACTIONS.md).</Banner>}
    </Card>}</StateView>
    <SectionHead title="Failed email deliveries" sub="After 5 failed attempts with backoff, a message stops retrying and appears here." />
    <StateView loading={q.loading} error={q.error} onRetry={q.reload} empty={(q.data ?? []).length === 0} emptyTitle="No failed emails">{(q.data ?? []).map((e) => <Card key={e.id} style={{ gap: 3, padding: 14 }}><Text style={styles.title}>{e.kind}</Text><Text style={styles.muted}>{e.attempts} attempts · {timeAgo(e.created_at)} · {e.last_error ?? 'unknown error'}</Text></Card>)}</StateView>
    <SectionHead title="Resume uploads" sub="Keep uploads OFF until the malware scanner has processed a test file in production. While OFF, candidates see an explanation and no file can wait in quarantine." />
    <Card style={styles.rowCard}><Text style={styles.title}>{flags.data?.resume_uploads_enabled ? 'Resume uploads are ON' : 'Resume uploads are OFF'}</Text>
      {flags.data && <PrimaryButton label={flags.data.resume_uploads_enabled ? 'Turn uploads off' : 'Turn uploads on'} variant="secondary" onPress={() => ask({ title: flags.data!.resume_uploads_enabled ? 'Turn resume uploads off' : 'Turn resume uploads on', message: 'Write what you verified (for example the scanner run ID).', confirm: 'Save', run: (reason) => supabase.rpc('admin_set_resume_uploads', { p_enabled: !flags.data!.resume_uploads_enabled, p_reason: reason }) })} />}</Card>
    <SectionHead title="Resume security queue" sub="File contents are never shown here. Quarantined files cannot be downloaded by anyone until a scanner marks them clean." />
    <StateView loading={resumes.loading} error={resumes.error} onRetry={resumes.reload} empty={(resumes.data ?? []).length === 0} emptyTitle="No resumes waiting or blocked">{(resumes.data ?? []).map((r) => <Card key={r.resume_id} style={styles.rowCard}>
      <View style={{ flex: 1 }}><Text style={styles.title}>{labelize(r.scan_status)}{r.scan_detail ? ` · ${r.scan_detail}` : ''}</Text><Text style={styles.muted}>Uploaded {timeAgo(r.created_at)} · {r.scan_attempts} scan attempts</Text></View>
      {r.scan_status === 'failed' && <PrimaryButton label="Retry scan" variant="secondary" onPress={() => ask({ title: 'Retry the security scan', confirm: 'Retry', run: (reason) => supabase.rpc('admin_retry_resume_scan', { p_resume: r.resume_id, p_reason: reason }) })} />}</Card>)}</StateView>
  </>;
}

function Access({ ask, tick }: P) {
  const roles = useLoad(async () => (unwrap(await supabase.rpc('admin_list_roles')) ?? []) as any[], [tick]);
  const versions = useLoad(async () => (unwrap(await supabase.rpc('admin_matching_versions')) ?? []) as any[], [tick]);
  const [target, setTarget] = useState(''); const [role, setRole] = useState('moderator'); const [w, setW] = useState({ skills: '35', location: '25', salary: '20', experience: '15', freshness: '5' });
  const sum = Object.values(w).reduce((a, b) => a + Number(b || 0), 0);
  return <><SectionHead title="Administrator roles" sub="Roles are granted only here, by an existing administrator. Choosing “Admin” on the login page grants nothing." />
    <StateView loading={roles.loading} error={roles.error} onRetry={roles.reload}>{(roles.data ?? []).map((r) => <Card key={`${r.user_id}${r.role}`} style={styles.rowCard}><View style={{ flex: 1 }}><Text style={styles.title}>{r.display_name}</Text><Text style={styles.muted}>{r.email}</Text></View><Pill>{r.role}</Pill><PrimaryButton label="Revoke" variant="ghost" onPress={() => ask({ title: `Revoke ${r.role} from ${r.display_name}`, confirm: 'Revoke', destructive: true, run: (reason) => supabase.rpc('admin_revoke_role', { p_user: r.user_id, p_role: r.role, p_reason: reason }) })} /></Card>)}</StateView>
    <Card style={{ gap: 10 }}><Text style={styles.title}>Grant a role</Text><Field label="User ID (copy from the Users tab lookup)" value={target} onChangeText={setTarget} autoCapitalize="none" /><Chips options={['moderator', 'support', 'privacy', 'admin'].map((r) => ({ id: r, label: r }))} selected={[role]} onToggle={setRole} />
      <PrimaryButton label="Grant role" disabled={!/^[0-9a-f-]{36}$/i.test(target)} onPress={() => ask({ title: `Grant ${role}`, confirm: 'Grant', run: (reason) => supabase.rpc('admin_grant_role', { p_user: target, p_role: role, p_reason: reason }) })} /></Card>
    <SectionHead title="Matching weights" sub="Changing weights creates a new version, applies to all new scores, and is audited. Weights must total 100." />
    <Card style={{ gap: 10 }}>{(versions.data ?? []).slice(0, 5).map((v) => <Text key={v.version} style={styles.muted}>v{v.version}{v.active ? ' (active)' : ''}: {Object.entries(v.weights).map(([k, x]) => `${k} ${x}`).join(', ')} · {v.reason}</Text>)}
      <Row>{(Object.keys(w) as (keyof typeof w)[]).map((k) => <Field key={k} label={labelize(k)} value={w[k]} onChangeText={(t) => setW({ ...w, [k]: t.replace(/\D/g, '') })} keyboardType="number-pad" />)}</Row><Text style={[styles.muted, sum !== 100 && { color: colors.danger }]}>Total: {sum}</Text>
      <PrimaryButton label="Publish new weights" disabled={sum !== 100} onPress={() => ask({ title: 'Change matching weights', message: 'Write what evidence justifies the change (at least 10 characters).', confirm: 'Publish', run: (reason) => supabase.rpc('admin_set_matching_weights', { p_weights: Object.fromEntries(Object.entries(w).map(([k, x]) => [k, Number(x)])), p_reason: reason }) })} /></Card></>;
}
const styles = StyleSheet.create({ metrics: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, title: { color: colors.ink, fontSize: 16, fontWeight: '900' }, muted: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 }, body: { color: colors.ink, fontSize: 15, lineHeight: 22 }, rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' } });
