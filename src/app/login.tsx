import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
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
import { NOTICE_VERSION } from '../content/legal';
import { validatePassword } from '../lib/password';
import { useAuthMethods } from '../lib/platform';
import { AccountKind, useAuth } from '../state/AuthContext';
import { colors } from '../theme';

type LoginRole = AccountKind | 'admin';
type IdentityKind = 'email' | 'phone';
type Mode = 'sign-in' | 'sign-up';

function indianPhone(value: string) {
  const digits = value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').slice(-10);
  return digits.length === 10 ? `+91${digits}` : null;
}

// Messages never confirm whether an email or phone number is registered.
function authMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'The email/mobile number or password is incorrect.';
  if (normalized.includes('already') || normalized.includes('exists') || normalized.includes('duplicate')) return 'We could not create an account with these details. If you already have an account, sign in or reset your password.';
  if (normalized.includes('rate limit') || normalized.includes('too many')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (normalized.includes('password')) return 'Choose a stronger password: at least 10 characters with upper case, lower case and a number.';
  if (normalized.includes('not confirmed')) return 'Please confirm your email address using the link we sent, then sign in.';
  if (normalized.includes('captcha')) return 'Please complete the security check and try again.';
  if (normalized.includes('fetch') || normalized.includes('network')) return 'You appear to be offline. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}

export default function LoginScreen() {
  const { role } = useLocalSearchParams<{ role?: string }>();
  const { refreshAccess, signOut } = useAuth();
  const initialRole: LoginRole = role === 'employer' || role === 'admin' ? role : 'candidate';
  const [loginRole, setLoginRole] = useState<LoginRole>(initialRole);
  const [mode, setMode] = useState<Mode>('sign-in');
  const [identityKind, setIdentityKind] = useState<IdentityKind>('email');
  const methods = useAuthMethods();
  // If the project disables phone sign-in, fall back to email.
  if (!methods.phone && identityKind === 'phone') setIdentityKind('email');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const normalizedPhone = useMemo(() => indianPhone(identifier), [identifier]);
  const normalizedEmail = identifier.trim().toLowerCase();

  function selectRole(nextRole: LoginRole) {
    setLoginRole(nextRole);
    if (nextRole === 'admin') setMode('sign-in');
    setMessage(null);
  }

  function credentials() {
    if (identityKind === 'email') {
      if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return null;
      return { email: normalizedEmail, password };
    }
    if (!normalizedPhone) return null;
    return { phone: normalizedPhone, password };
  }

  async function continueToPortal() {
    const access = await refreshAccess();
    if (!access || access.status !== 'active') {
      await signOut();
      setMessage('This account is unavailable. Please contact KaamSetu support.');
      return;
    }
    if (loginRole === 'admin') {
      if (!access.is_admin) {
        await signOut();
        setMessage('This account does not have administrator access.');
        return;
      }
      router.replace('/admin');
      return;
    }
    if (access.account_kind !== loginRole) {
      await signOut();
      setMessage(`This account is registered as an ${access.account_kind}. Select the correct account type and sign in again.`);
      return;
    }
    router.replace(access.account_kind === 'candidate' ? '/candidate' : '/employer');
  }

  async function submit() {
    const authCredentials = credentials();
    if (!authCredentials) return setMessage(identityKind === 'email' ? 'Enter a valid email address.' : 'Enter a valid 10-digit Indian mobile number.');
    if (mode === 'sign-in' && !password) return setMessage('Enter your password.');
    if (mode === 'sign-up') {
      const weak = validatePassword(password); if (weak) return setMessage(weak);
      if (loginRole === 'admin') return setMessage('Administrator accounts can only be created by the platform owner.');
      if (!name.trim()) return setMessage('Please enter your full name.');
      if (password !== confirmPassword) return setMessage('The passwords do not match.');
      if (!accepted) return setMessage('Please confirm that you are 18+ and accept the Privacy Notice and Terms.');
    }

    setBusy(true);
    setMessage(null);
    if (mode === 'sign-in') {
      const { error } = await supabase.auth.signInWithPassword(authCredentials);
      if (error) {
        setBusy(false);
        return setMessage(authMessage(error.message));
      }
      await continueToPortal();
      setBusy(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      ...authCredentials,
      options: { data: { display_name: name.trim(), account_kind: loginRole, accepted_notice_version: NOTICE_VERSION } },
    });
    if (error) {
      setBusy(false);
      return setMessage(authMessage(error.message));
    }
    // Supabase returns a user with no identities when the address is already registered. Show the same
    // neutral message as a fresh sign-up so the screen never reveals which addresses have accounts.
    if (data.user?.identities?.length === 0 || !data.session) {
      if (data.session) await supabase.auth.signOut();
      setBusy(false);
      return setMessage(identityKind === 'email'
        ? 'Check your inbox. If this email can be used, we sent a confirmation link. Confirm it, then sign in.'
        : 'Your account was created but mobile confirmation is enabled in the server settings. Contact support to activate it without SMS.');
    }
    await continueToPortal();
    setBusy(false);
  }

  async function requestPasswordReset() {
    if (identityKind !== 'email' || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) return setMessage('Enter your registered email address first.');
    setBusy(true);
    setMessage(null);
    const webOrigin = Platform.OS === 'web' && typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : null;
    const redirectTo = webOrigin ? `${webOrigin}/reset-password` : Linking.createURL('/reset-password');
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
    setBusy(false);
    setMessage(error ? authMessage(error.message) : 'If this email is registered, a secure password-reset link has been sent.');
  }

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.ink} /><Text style={styles.backText}>Back</Text></Pressable>
      <Card style={styles.card}>
        <View style={styles.brand}><Logo /><Pill tone="saffron">Password protected</Pill></View>
        <View style={styles.modeRow}><ModeButton active={mode === 'sign-in'} label="Sign in" onPress={() => setMode('sign-in')} /><ModeButton active={mode === 'sign-up'} label="Create account" disabled={loginRole === 'admin'} onPress={() => setMode('sign-up')} /></View>
        <View style={styles.copy}><Text style={styles.title}>{mode === 'sign-in' ? 'Welcome back' : 'Join KaamSetu'}</Text><Text style={styles.subtitle}>{mode === 'sign-in' ? 'Use your registered email or mobile number and password.' : 'One person, one account. Choose how you want to use KaamSetu.'}</Text></View>
        <View style={styles.switchRow}><Choice active={loginRole === 'candidate'} label="Candidate" icon="person" onPress={() => selectRole('candidate')} /><Choice active={loginRole === 'employer'} label="Employer" icon="business" onPress={() => selectRole('employer')} /><Choice active={loginRole === 'admin'} label="Admin" icon="shield-checkmark" onPress={() => selectRole('admin')} /></View>
        {mode === 'sign-up' && <Field label="Full name" value={name} onChangeText={setName} placeholder="Your full name" autoComplete="name" />}
        {methods.phone && <View style={styles.identityRow}><ModeButton active={identityKind === 'email'} label="Email address" onPress={() => { setIdentityKind('email'); setIdentifier(''); }} /><ModeButton active={identityKind === 'phone'} label="Mobile number" onPress={() => { setIdentityKind('phone'); setIdentifier(''); }} /></View>}
        <Field label={identityKind === 'email' ? 'Email address' : 'Indian mobile number'} value={identifier} onChangeText={setIdentifier} placeholder={identityKind === 'email' ? 'name@example.com' : '98765 43210'} keyboardType={identityKind === 'email' ? 'email-address' : 'phone-pad'} prefix={identityKind === 'phone' ? '+91' : undefined} autoCapitalize="none" autoCorrect={false} autoComplete={identityKind === 'email' ? 'email' : 'tel'} />
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 10 characters" secureTextEntry={!showPassword} autoCapitalize="none" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} rightIcon={showPassword ? 'eye-off-outline' : 'eye-outline'} onRightPress={() => setShowPassword((value) => !value)} />
        {mode === 'sign-up' && <Field label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Enter the same password again" secureTextEntry={!showPassword} autoCapitalize="none" autoComplete="new-password" />}
        {mode === 'sign-up' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} accessibilityLabel="I am 18 or older and agree to the Privacy Notice and Terms" onPress={() => setAccepted((value) => !value)} style={styles.consent}><Ionicons name={accepted ? 'checkbox' : 'square-outline'} size={22} color={accepted ? colors.teal : colors.inkSoft} /><Text style={styles.consentText}>I am 18 or older and agree to the Privacy Notice and Terms. KaamSetu will use my chosen identifier for account security and essential updates.</Text></Pressable>}
        <PrimaryButton label={busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in securely' : 'Create my account'} onPress={submit} disabled={busy} icon={mode === 'sign-in' ? 'log-in-outline' : 'person-add-outline'} />
        {mode === 'sign-in' && identityKind === 'email' && <Pressable accessibilityRole="button" onPress={requestPasswordReset} disabled={busy}><Text style={styles.forgot}>Forgot password?</Text></Pressable>}
        {message && <View accessibilityRole="alert" style={styles.message}><Ionicons name="information-circle" size={19} color={colors.teal} /><Text style={styles.messageText}>{message}</Text></View>}
        <Text style={styles.help}>{loginRole === 'admin' ? 'Administrator access is granted only by the platform owner.' : 'Your email address or mobile number can be registered only once.'}</Text>
      </Card>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

function ModeButton({ active, disabled, label, onPress }: { active: boolean; disabled?: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive, disabled && styles.disabled]}><Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text></Pressable>;
}

function Choice({ active, label, icon, onPress }: { active: boolean; label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.choice, active && styles.choiceActive]}><Ionicons name={icon} size={20} color={active ? colors.teal : colors.inkSoft} /><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

function Field({ label, prefix, rightIcon, onRightPress, ...props }: React.ComponentProps<typeof TextInput> & { label: string; prefix?: string; rightIcon?: keyof typeof Ionicons.glyphMap; onRightPress?: () => void }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.inputWrap}>{prefix && <Text style={styles.prefix}>{prefix}</Text>}<TextInput accessibilityLabel={label} {...props} style={styles.input} placeholderTextColor="#9AA1B2" />{rightIcon && <Pressable accessibilityRole="button" accessibilityLabel={rightIcon === 'eye-off-outline' ? 'Hide password' : 'Show password'} onPress={onRightPress} hitSlop={10}><Ionicons name={rightIcon} size={20} color={colors.inkSoft} /></Pressable>}</View></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream }, flex: { flex: 1 }, page: { flexGrow: 1, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 18 },
  back: { alignSelf: 'center', width: '100%', maxWidth: 620, flexDirection: 'row', alignItems: 'center', gap: 7 }, backText: { color: colors.ink, fontWeight: '800' },
  card: { width: '100%', maxWidth: 620, padding: 30, gap: 20, borderRadius: 30 }, brand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  modeRow: { flexDirection: 'row', borderRadius: 14, backgroundColor: colors.muted, padding: 4 }, identityRow: { flexDirection: 'row', gap: 8 }, modeButton: { flex: 1, minHeight: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, modeButtonActive: { backgroundColor: '#FFF', borderWidth: 1, borderColor: colors.line }, modeText: { color: colors.inkSoft, fontWeight: '800', fontSize: 13 }, modeTextActive: { color: colors.tealDark }, disabled: { opacity: 0.45 },
  copy: { gap: 8 }, title: { color: colors.ink, fontSize: 32, lineHeight: 38, fontWeight: '900', letterSpacing: -1 }, subtitle: { color: colors.inkSoft, fontSize: 15, lineHeight: 23 },
  switchRow: { flexDirection: 'row', gap: 9 }, choice: { flex: 1, minHeight: 68, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 10, alignItems: 'center', justifyContent: 'center', gap: 7 }, choiceActive: { borderColor: colors.teal, backgroundColor: colors.tealPale }, choiceText: { color: colors.inkSoft, fontSize: 12, fontWeight: '800', textAlign: 'center' }, choiceTextActive: { color: colors.tealDark },
  field: { gap: 7 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, inputWrap: { minHeight: 54, borderWidth: 1, borderColor: '#D8DBE7', borderRadius: 15, backgroundColor: '#FFF', paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center' }, prefix: { color: colors.ink, fontWeight: '800', marginRight: 8 }, input: { flex: 1, minHeight: 52, color: colors.ink, fontSize: 16, outlineStyle: 'none' } as never,
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, consentText: { flex: 1, color: colors.inkSoft, fontSize: 12, lineHeight: 18 }, forgot: { color: colors.teal, textAlign: 'center', fontSize: 13, fontWeight: '800' }, message: { flexDirection: 'row', gap: 8, backgroundColor: colors.tealPale, padding: 12, borderRadius: 13 }, messageText: { flex: 1, color: colors.tealDark, fontSize: 12, lineHeight: 18, fontWeight: '700' }, help: { color: colors.inkSoft, textAlign: 'center', fontSize: 11, lineHeight: 16 },
});
