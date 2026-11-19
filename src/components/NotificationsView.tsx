import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { friendlyError, timeAgo } from '../lib/format';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { AppShell } from './AppShell';
import { Banner, SectionHead, StateView, unwrap, useLoad } from './kit';
import { Card, PrimaryButton } from './ui';

type Note = { id: string; kind: string; title: string; body: string; read_at: string | null; created_at: string };

export function NotificationsView({ role }: { role: string }) {
  const { data, loading, error, reload } = useLoad(async () => (unwrap(await supabase.from('notifications').select('id,kind,title,body,read_at,created_at').order('created_at', { ascending: false }).limit(100)) ?? []) as Note[], []);
  const [msg, setMsg] = React.useState<string | null>(null);
  async function markAll() { const { error: e } = await supabase.rpc('mark_notifications_read'); if (e) setMsg(friendlyError(e)); else await reload(); }
  async function markOne(id: string) { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id); await reload(); }
  const unread = (data ?? []).filter((n) => !n.read_at).length;
  return <AppShell role={role} title="Notifications" subtitle={unread ? `${unread} unread` : 'You are all caught up'}>
    <SectionHead title="Recent activity" right={unread > 0 ? <PrimaryButton label="Mark all as read" variant="secondary" icon="checkmark-done" onPress={markAll} /> : undefined} />
    {msg && <Banner tone="error">{msg}</Banner>}
    <StateView loading={loading} error={error} onRetry={reload} empty={(data ?? []).length === 0} emptyTitle="No notifications yet" emptyText="Updates about applications, interviews and invitations appear here.">
      <View style={{ gap: 10 }}>{(data ?? []).map((n) => <Card key={n.id} style={[styles.row, !n.read_at && styles.unread]}>
        <Ionicons name={n.kind.startsWith('interview') ? 'calendar-outline' : n.kind.startsWith('security') ? 'shield-outline' : n.kind.startsWith('invitation') ? 'mail-outline' : 'notifications-outline'} size={22} color={colors.teal} />
        <View style={{ flex: 1 }}><Text style={styles.title}>{n.title}</Text><Text style={styles.body}>{n.body}</Text><Text style={styles.time}>{timeAgo(n.created_at)}</Text></View>
        {!n.read_at && <PrimaryButton label="Mark read" variant="ghost" onPress={() => markOne(n.id)} />}
      </Card>)}</View>
    </StateView>
  </AppShell>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: 16 }, unread: { borderColor: colors.teal, backgroundColor: '#FAFAFF' }, title: { color: colors.ink, fontWeight: '800', fontSize: 15 }, body: { color: colors.inkSoft, fontSize: 14, marginTop: 2 }, time: { color: colors.inkSoft, fontSize: 12, marginTop: 4 } });
