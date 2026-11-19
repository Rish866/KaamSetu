import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from '../state/AuthContext';
import { colors } from '../theme';

export default function RootLayout() {
  return <AuthProvider><StatusBar style="dark" /><RootNavigator /></AuthProvider>;
}

function RootNavigator() {
  const { access, loading, session } = useAuth();
  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color={colors.teal} /></View>;
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

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream } });
