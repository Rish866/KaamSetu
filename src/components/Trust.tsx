import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { Chips } from './kit';

export type OutcomeContext = 'rejected' | 'withdrawn' | 'offer_declined' | 'offer_withdrawn' | 'left_before_day_30';
type Reason = { code: string; label: string; actor: 'employer' | 'candidate' | 'either'; contexts: string[] };

let cache: Promise<Reason[]> | null = null;
/** The fixed, neutral reason catalogue (public.outcome_reasons). Loaded once per session. */
function loadReasons(): Promise<Reason[]> {
  cache ??= (async () => {
    const { data, error } = await supabase.from('outcome_reasons').select('code,label,actor,contexts').order('label');
    if (error) { cache = null; throw error; }
    return (data ?? []) as Reason[];
  })();
  return cache;
}

/** One-tap reason chips for closing an application or hire. The database enforces the same rules. */
export function ReasonChips({ context, side, value, onChange, required = false }: {
  context: OutcomeContext; side: 'employer' | 'candidate'; value: string | null; onChange: (code: string | null) => void; required?: boolean }) {
  const [reasons, setReasons] = useState<Reason[] | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let on = true; loadReasons().then((r) => on && setReasons(r)).catch(() => on && setFailed(true)); return () => { on = false; }; }, []);
  if (failed) return <Text style={styles.small}>Could not load reasons. Close and try again.</Text>;
  if (!reasons) return null;
  const options = reasons.filter((r) => r.contexts.includes(context) && (r.actor === 'either' || r.actor === side)).map((r) => ({ id: r.code, label: r.label }));
  return <View style={{ gap: 4 }}>
    <Chips label={required ? 'Main reason (required)' : 'Main reason (optional)'} options={options} selected={value ? [value] : []} onToggle={(id) => onChange(value === id ? null : id)} />
    <Text style={styles.small}>Reasons come from a fixed list, are shown to both sides and are counted, without names, in reliability records.</Text>
  </View>;
}

const notices = {
  job: 'KaamSetu is free for candidates. No employer or recruiter may ask you for money, deposits, "registration" or training fees. If anyone does, report the job.',
  apply: 'Applying is free. You will never be asked to pay to apply, interview or join. Report anyone who asks for money.',
  offer: 'A genuine offer never requires a payment, deposit or purchase from you. If you are asked to pay, do not pay and report it to KaamSetu.',
  contact: 'Never ask candidates for money, deposits or fees. Doing so gets your company suspended. Contact details are shared only for this hiring process.',
} as const;

/** Anti-scam and zero-fee reminder shown where money requests usually happen. */
export function TrustNotice({ context }: { context: keyof typeof notices }) {
  return <View accessibilityRole="text" style={styles.notice}>
    <Ionicons name="shield-checkmark-outline" size={18} color={colors.tealDark} />
    <Text style={styles.noticeText}>{notices[context]}</Text>
  </View>;
}

const styles = StyleSheet.create({
  small: { color: colors.inkSoft, fontSize: 12, lineHeight: 17 },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.tealPale, borderRadius: 12, padding: 10 },
  noticeText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: '600' },
});
