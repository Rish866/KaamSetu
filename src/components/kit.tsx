import { Ionicons } from '@expo/vector-icons';
import React, { PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { friendlyError } from '../lib/format';
import { colors } from '../theme';
import { Card, PrimaryButton } from './ui';

/** Loads data with explicit loading, error and retry states. Reloads when `deps` change. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const loaderRef = useRef(loader);
  const alive = useRef(true);
  const key = JSON.stringify(deps);
  useEffect(() => { loaderRef.current = loader; });
  const load = useCallback(async () => {
    try { const next = await loaderRef.current(); if (alive.current) { setData(next); setError(null); } }
    catch (e) { if (alive.current) setError(friendlyError(e as { message?: string; code?: string })); }
    finally { if (alive.current) setSettled(key); }
  }, [key]);
  const reload = useCallback(async () => { setReloading(true); await load(); if (alive.current) setReloading(false); }, [load]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  return { data, error, loading: settled !== key || reloading, reload, setData };
}

/** Throws Supabase errors so useLoad can show them; returns data otherwise. */
export function unwrap<T>(result: { data: T; error: { message?: string; code?: string } | null }): T {
  if (result.error) throw result.error;
  return result.data;
}

export function StateView({ loading, error, onRetry, empty, emptyTitle, emptyText, children }: PropsWithChildren<{
  loading: boolean; error: string | null; onRetry: () => void; empty?: boolean; emptyTitle?: string; emptyText?: string }>) {
  if (loading) return <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel="Loading"><ActivityIndicator size="large" color={colors.teal} /></View>;
  if (error) return <Card style={styles.stateCard}><Ionicons name="cloud-offline-outline" size={26} color={colors.danger} /><Text accessibilityRole="alert" style={styles.stateTitle}>{error}</Text><PrimaryButton label="Try again" icon="refresh" onPress={onRetry} /></Card>;
  if (empty) return <Card style={styles.stateCard}><Ionicons name="file-tray-outline" size={26} color={colors.inkSoft} /><Text style={styles.stateTitle}>{emptyTitle ?? 'Nothing here yet'}</Text>{emptyText && <Text style={styles.stateText}>{emptyText}</Text>}</Card>;
  return <>{children}</>;
}

export function Field({ label, error, hint, ...props }: React.ComponentProps<typeof TextInput> & { label: string; error?: string | null; hint?: string }) {
  const [focused, setFocused] = useState(false);
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor="#8A91A5" {...props} onFocus={(e) => { setFocused(true); props.onFocus?.(e); }} onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={[styles.input, props.multiline && styles.multiline, focused && styles.inputFocus, Boolean(error) && styles.inputError, props.style]} />
    {hint && !error && <Text style={styles.hint}>{hint}</Text>}
    {error && <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>}
  </View>;
}

export type Option = { id: string; label: string };
export function Chips({ label, options, selected, onToggle }: { label?: string; options: Option[]; selected: string[]; onToggle: (id: string) => void }) {
  return <View style={styles.field}>{label && <Text style={styles.label}>{label}</Text>}<View style={styles.chipRow}>{options.map((o) => {
    const on = selected.includes(o.id);
    return <Pressable key={o.id} accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: on }} onPress={() => onToggle(o.id)} style={[styles.chip, on && styles.chipOn]}><Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text></Pressable>;
  })}</View></View>;
}

export function Banner({ tone = 'info', children }: PropsWithChildren<{ tone?: 'info' | 'error' | 'success' | 'warn' }>) {
  const bg = { info: colors.tealPale, error: '#FDE8EC', success: '#E3F6EE', warn: colors.saffronPale }[tone];
  return <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={[styles.banner, { backgroundColor: bg }]}><Text style={styles.bannerText}>{children}</Text></View>;
}

export function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return <View style={styles.sectionHead}><View style={{ flex: 1, minWidth: 200 }}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{sub && <Text style={styles.sectionSub}>{sub}</Text>}</View>{right}</View>;
}

/** Destructive or sensitive action: asks for confirmation and, optionally, a written reason. */
export function ConfirmDialog(props: React.ComponentProps<typeof ConfirmInner>) { return props.visible ? <ConfirmInner {...props} /> : null; }

function ConfirmInner({ visible, title, message, confirmLabel, requireReason = false, minReason = 5, destructive = false, onConfirm, onCancel, children }: PropsWithChildren<{
  visible: boolean; title: string; message?: string; confirmLabel: string; requireReason?: boolean; minReason?: number; destructive?: boolean;
  onConfirm: (reason: string) => Promise<void> | void; onCancel: () => void }>) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const tooShort = requireReason && reason.trim().length < minReason;
  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm(reason.trim()); } catch (e) { setError(friendlyError(e as { message?: string; code?: string })); } finally { setBusy(false); }
  }
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}><View style={styles.overlay}><View accessibilityViewIsModal style={styles.dialog}>
    <Text accessibilityRole="header" style={styles.dialogTitle}>{title}</Text>{message && <Text style={styles.stateText}>{message}</Text>}
    {children}
    {requireReason && <Field label="Reason (recorded in the audit log)" value={reason} onChangeText={setReason} multiline hint={`At least ${minReason} characters`} />}
    {error && <Banner tone="error">{error}</Banner>}
    <View style={styles.dialogActions}><PrimaryButton label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} /><PrimaryButton label={busy ? 'Working…' : confirmLabel} icon={destructive ? 'warning-outline' : 'checkmark'} disabled={busy || tooShort} onPress={go} /></View>
  </View></View></Modal>;
}

export function Row({ children, gap = 10, wrap = true }: PropsWithChildren<{ gap?: number; wrap?: boolean }>) {
  return <View style={{ flexDirection: 'row', gap, flexWrap: wrap ? 'wrap' : 'nowrap', alignItems: 'center' }}>{children}</View>;
}

const styles = StyleSheet.create({
  center: { padding: 40, alignItems: 'center' }, stateCard: { alignItems: 'center', gap: 10, padding: 28 }, stateTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', textAlign: 'center' }, stateText: { color: colors.inkSoft, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  field: { gap: 7, flexGrow: 1, flexShrink: 1, minWidth: 180 }, label: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#C9CEDD', borderRadius: 14, paddingHorizontal: 14, color: colors.ink, backgroundColor: '#FFF', fontSize: 16 },
  inputFocus: { borderColor: colors.teal, borderWidth: 2 }, inputError: { borderColor: colors.danger }, multiline: { minHeight: 110, paddingTop: 12, textAlignVertical: 'top' },
  hint: { color: colors.inkSoft, fontSize: 13 }, errorText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: '#C9CEDD', backgroundColor: '#FFF' },
  chipOn: { backgroundColor: colors.teal, borderColor: colors.teal }, chipFocus: { borderColor: colors.ink, borderWidth: 2 }, chipText: { color: colors.ink, fontSize: 14, fontWeight: '700' }, chipTextOn: { color: '#FFF' },
  banner: { padding: 14, borderRadius: 14 }, bannerText: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  sectionHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 6 }, sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 }, sectionSub: { color: colors.inkSoft, fontSize: 14, lineHeight: 20, marginTop: 3 },
  overlay: { flex: 1, backgroundColor: 'rgba(17,21,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 }, dialog: { backgroundColor: '#FFF', borderRadius: 22, padding: 22, gap: 14, width: '100%', maxWidth: 480 }, dialogTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' }, dialogActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' },
});
