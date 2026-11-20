import { validatePassword } from '../lib/password';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Logo, PrimaryButton } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function updatePassword() {
    const weak = validatePassword(password); if (weak) return setMessage(weak);
    if (password !== confirmPassword) return setMessage('The passwords do not match.');
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage('This reset link is invalid or expired. Request a new link from the sign-in page.');
    setMessage('Your password has been updated. You can now sign in.');
    await supabase.auth.signOut();
  }

  return <SafeAreaView style={styles.safe}><View style={styles.page}><Card style={styles.card}>
    <Logo />
    <View style={styles.copy}><Text style={styles.title}>Choose a new password</Text><Text style={styles.subtitle}>Use at least 10 characters with upper case, lower case and a number. Do not reuse a password from another service.</Text></View>
    <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
    <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoComplete="new-password" />
    <PrimaryButton label={busy ? 'Updating…' : 'Update password'} onPress={updatePassword} disabled={busy} icon="key-outline" />
    {message && <View accessibilityRole="alert" style={styles.message}><Ionicons name="information-circle" size={19} color={colors.teal} /><Text style={styles.messageText}>{message}</Text></View>}
    <Pressable accessibilityRole="link" onPress={() => router.replace('/login')}><Text style={styles.back}>Return to sign in</Text></Pressable>
  </Card></View></SafeAreaView>;
}

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} {...props} style={styles.input} placeholder="At least 10 characters" placeholderTextColor="#9AA1B2" /></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream }, page: { flex: 1, padding: 22, alignItems: 'center', justifyContent: 'center' }, card: { width: '100%', maxWidth: 520, padding: 30, gap: 20, borderRadius: 30 }, copy: { gap: 8 }, title: { color: colors.ink, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 }, subtitle: { color: colors.inkSoft, fontSize: 14, lineHeight: 22 }, field: { gap: 7 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, input: { minHeight: 54, borderWidth: 1, borderColor: '#D8DBE7', borderRadius: 15, backgroundColor: '#FFF', paddingHorizontal: 15, color: colors.ink, fontSize: 16 }, message: { flexDirection: 'row', gap: 8, backgroundColor: colors.tealPale, padding: 12, borderRadius: 13 }, messageText: { flex: 1, color: colors.tealDark, fontSize: 12, lineHeight: 18, fontWeight: '700' }, back: { color: colors.teal, textAlign: 'center', fontWeight: '800' },
});
