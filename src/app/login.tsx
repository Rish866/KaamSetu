import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Card, Logo, Pill, PrimaryButton } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

type AccountKind = 'candidate' | 'employer';

function indianPhone(value: string) {
  const digits = value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').slice(-10);
  return digits.length === 10 ? `+91${digits}` : null;
}

export default function LoginScreen() {
  const { role } = useLocalSearchParams<{ role?: string }>();
  const [kind, setKind] = useState<AccountKind>(role === 'employer' ? 'employer' : 'candidate');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const normalizedPhone = useMemo(() => indianPhone(phone), [phone]);

  async function sendOtp() {
    if (!name.trim()) return setMessage('Please enter your name.');
    if (!normalizedPhone) return setMessage('Enter a valid 10-digit Indian mobile number.');
    if (!accepted) return setMessage('Please confirm that you are 18+ and accept the privacy notice.');
    setBusy(true); setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      phone: normalizedPhone,
      options: { data: { display_name: name.trim(), account_kind: kind } },
    });
    setBusy(false);
    if (error) return setMessage(error.message);
    setStep('otp');
    setMessage(`We sent a 6-digit code to +91 ${normalizedPhone.slice(-10, -5)} ${normalizedPhone.slice(-5)}.`);
  }

  async function verifyOtp() {
    if (!normalizedPhone || otp.replace(/\D/g, '').length !== 6) return setMessage('Enter the 6-digit code.');
    setBusy(true); setMessage(null);
    const { error } = await supabase.auth.verifyOtp({ phone: normalizedPhone, token: otp.replace(/\D/g, ''), type: 'sms' });
    setBusy(false);
    if (error) return setMessage(error.message);
    router.replace(kind === 'candidate' ? '/candidate' : '/employer');
  }

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.ink} /><Text style={styles.backText}>Back</Text></Pressable>
      <Card style={styles.card}>
        <View style={styles.brand}><Logo /><Pill tone="saffron">Secure phone sign-in</Pill></View>
        <View style={styles.copy}><Text style={styles.title}>{step === 'phone' ? 'Welcome to KaamSetu' : 'Enter your code'}</Text><Text style={styles.subtitle}>{step === 'phone' ? 'One account for verified jobs, applications and employer invitations.' : 'The code expires shortly. Never share it with anyone.'}</Text></View>
        {step === 'phone' ? <>
          <View style={styles.switchRow}><Choice active={kind === 'candidate'} label="I’m looking for work" icon="person" onPress={() => setKind('candidate')} /><Choice active={kind === 'employer'} label="I’m hiring" icon="business" onPress={() => setKind('employer')} /></View>
          <Field label="Your name" value={name} onChangeText={setName} placeholder="Full name" autoComplete="name" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} placeholder="98765 43210" keyboardType="phone-pad" prefix="+91" autoComplete="tel" />
          <Pressable onPress={() => setAccepted((value) => !value)} style={styles.consent}><Ionicons name={accepted ? 'checkbox' : 'square-outline'} size={22} color={accepted ? colors.teal : colors.inkSoft} /><Text style={styles.consentText}>I am 18 or older and agree to the Privacy Notice and Terms. KaamSetu will use my number for account security and essential updates.</Text></Pressable>
          <PrimaryButton label={busy ? 'Sending code…' : 'Send OTP'} onPress={sendOtp} disabled={busy} icon="phone-portrait-outline" />
        </> : <>
          <Field label="6-digit OTP" value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" keyboardType="number-pad" autoComplete="one-time-code" />
          <PrimaryButton label={busy ? 'Checking…' : 'Verify and continue'} onPress={verifyOtp} disabled={busy} icon="shield-checkmark-outline" />
          <PrimaryButton label="Change mobile number" onPress={() => { setStep('phone'); setOtp(''); setMessage(null); }} variant="ghost" />
        </>}
        {message && <View style={styles.message}><Ionicons name="information-circle" size={19} color={colors.teal} /><Text style={styles.messageText}>{message}</Text></View>}
        <Text style={styles.help}>Standard SMS charges may apply. KaamSetu never asks for your OTP by phone or chat.</Text>
      </Card>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

function Choice({ active, label, icon, onPress }: { active: boolean; label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}><Ionicons name={icon} size={20} color={active ? colors.teal : colors.inkSoft} /><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

function Field({ label, prefix, ...props }: React.ComponentProps<typeof TextInput> & { label: string; prefix?: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.inputWrap}>{prefix && <Text style={styles.prefix}>{prefix}</Text>}<TextInput {...props} style={styles.input} placeholderTextColor="#9AA1B2" /></View></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream }, flex: { flex: 1 }, page: { flexGrow: 1, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 18 },
  back: { alignSelf: 'center', width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', gap: 7 }, backText: { color: colors.ink, fontWeight: '800' },
  card: { width: '100%', maxWidth: 560, padding: 30, gap: 22, borderRadius: 30 }, brand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  copy: { gap: 8 }, title: { color: colors.ink, fontSize: 32, lineHeight: 38, fontWeight: '900', letterSpacing: -1 }, subtitle: { color: colors.inkSoft, fontSize: 15, lineHeight: 23 },
  switchRow: { flexDirection: 'row', gap: 10 }, choice: { flex: 1, minHeight: 70, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 7 }, choiceActive: { borderColor: colors.teal, backgroundColor: colors.tealPale }, choiceText: { color: colors.inkSoft, fontSize: 12, fontWeight: '800', textAlign: 'center' }, choiceTextActive: { color: colors.tealDark },
  field: { gap: 7 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, inputWrap: { minHeight: 54, borderWidth: 1, borderColor: '#D8DBE7', borderRadius: 15, backgroundColor: '#FFF', paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center' }, prefix: { color: colors.ink, fontWeight: '800', marginRight: 8 }, input: { flex: 1, minHeight: 52, color: colors.ink, fontSize: 16, outlineStyle: 'none' } as never,
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, consentText: { flex: 1, color: colors.inkSoft, fontSize: 12, lineHeight: 18 }, message: { flexDirection: 'row', gap: 8, backgroundColor: colors.tealPale, padding: 12, borderRadius: 13 }, messageText: { flex: 1, color: colors.tealDark, fontSize: 12, lineHeight: 18, fontWeight: '700' }, help: { color: colors.inkSoft, textAlign: 'center', fontSize: 11, lineHeight: 16 },
});
