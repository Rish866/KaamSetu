import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { AuthProvider, useAuth } from '../state/AuthContext';
import { colors } from '../theme';

export default function RootLayout() {
  return <AuthProvider><StatusBar style="dark" /><RootNavigator /></AuthProvider>;
}

// The database version this build needs. If production has not been migrated yet, show maintenance instead of errors.
const REQUIRED_SCHEMA = '202611200004';
type SchemaState = 'checking' | 'ok' | 'outdated';

function useSchemaCheck(): SchemaState {
  const [state, setState] = useState<SchemaState>('checking');
  useEffect(() => {
    let alive = true;
    void supabase.rpc('schema_version').then(({ data, error }) => {
      if (!alive) return;
      // Missing function (PGRST202) or an older version means the database is behind this app. Network errors fall through to normal offline handling.
      if (error?.code === 'PGRST202' || (typeof data === 'string' && data < REQUIRED_SCHEMA)) setState('outdated'); else setState('ok');
    });
    return () => { alive = false; };
  }, []);
  return state;
}

function RootNavigator() {
  const { access, loading, session } = useAuth();
  const schema = useSchemaCheck();
  if (schema === 'outdated') return <View style={styles.loading}><Text accessibilityRole="header" style={styles.title}>KaamSetu is being updated</Text><Text style={styles.text}>We are upgrading the service. Please try again in a few minutes.</Text></View>;
  if (loading || schema === 'checking') return <View style={styles.loading}><ActivityIndicator size="large" color={colors.teal} /></View>;
  const active = Boolean(session && access?.status === 'active');
  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="login" />
    <Stack.Screen name="reset-password" />
    <Stack.Screen name="privacy" />
    <Stack.Screen name="terms" />
    <Stack.Screen name="support" />
    <Stack.Protected guard={active && access?.account_kind === 'candidate'} redirectTo="/login">
      <Stack.Screen name="candidate" />
    </Stack.Protected>
    <Stack.Protected guard={active && access?.account_kind === 'employer'} redirectTo="/login">
      <Stack.Screen name="employer" />
      <Stack.Screen name="post-job" />
    </Stack.Protected>
    <Stack.Protected guard={active && Boolean(access?.is_admin)} redirectTo="/login">
      <Stack.Screen name="admin" />
    </Stack.Protected>
  </Stack>;
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream, padding: 24, gap: 10 }, title: { color: colors.ink, fontSize: 22, fontWeight: '900', textAlign: 'center' }, text: { color: colors.inkSoft, fontSize: 16, textAlign: 'center' } });
