import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { AuthProvider, useAuth } from '../state/AuthContext';
import { colors } from '../theme';

export default function RootLayout() {
  return <AuthProvider><StatusBar style="dark" /><RootNavigator /></AuthProvider>;
}

// The database version this build needs. If production has not been migrated yet, show maintenance instead of errors.
const REQUIRED_SCHEMA = '202611260004';
type SchemaState = 'unknown' | 'ok' | 'outdated';

/** Never blocks rendering: the app renders normally and only switches to maintenance on a confirmed outdated schema. */
function useSchemaCheck(): SchemaState {
  const [state, setState] = useState<SchemaState>('unknown');
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => { alive = false; }, 8000);
    void Promise.resolve(supabase.rpc('schema_version')).then(({ data, error }) => {
      if (!alive) return;
      // Missing function (PGRST202) or an older version means the database is behind this app. Network errors fall through to normal offline handling.
      if (error?.code === 'PGRST202' || (typeof data === 'string' && data < REQUIRED_SCHEMA)) setState('outdated'); else setState('ok');
    }, () => undefined).finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return state;
}

function RootNavigator() {
  const { access, loading, session } = useAuth();
  const schema = useSchemaCheck();
  // During a release window the database may be behind this website build. Public pages (home, privacy, terms,
  // support, maintenance) stay available; everything that needs the new database goes to /maintenance.
  const ready = schema !== 'outdated';
  const away = ready ? '/login' : '/maintenance';
  if (loading && ready) return <View style={styles.loading}><ActivityIndicator size="large" color={colors.teal} /></View>;
  const active = ready && Boolean(session && access?.status === 'active');
  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="privacy" />
    <Stack.Screen name="terms" />
    <Stack.Screen name="support" />
    <Stack.Screen name="maintenance" />
    <Stack.Protected guard={ready} redirectTo="/maintenance">
      <Stack.Screen name="login" />
      <Stack.Screen name="reset-password" />
    </Stack.Protected>
    <Stack.Protected guard={active && access?.account_kind === 'candidate'} redirectTo={away}>
      <Stack.Screen name="candidate" />
    </Stack.Protected>
    <Stack.Protected guard={active && access?.account_kind === 'employer'} redirectTo={away}>
      <Stack.Screen name="employer" />
      <Stack.Screen name="post-job" />
    </Stack.Protected>
    <Stack.Protected guard={active && Boolean(access?.is_admin)} redirectTo={away}>
      <Stack.Screen name="admin" />
    </Stack.Protected>
  </Stack>;
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream } });
