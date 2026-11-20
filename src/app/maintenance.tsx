import { router } from 'expo-router';
import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Card, Logo, PrimaryButton } from '../components/ui';
import { colors } from '../theme';

// Shown only while the database is being upgraded during a release (the app detects an older schema version).
export default function Maintenance() {
  return <SafeAreaView style={styles.safe}><View style={styles.page}><Card style={styles.card}>
    <Logo />
    <Text accessibilityRole="header" style={styles.title}>KaamSetu is being updated</Text>
    <Text style={styles.text}>Sign-in and your dashboard are briefly unavailable while we upgrade the service. This usually takes a few minutes. Your account and data are safe.</Text>
    <PrimaryButton label="Try again" icon="refresh" onPress={() => { if (typeof window !== 'undefined' && window.location) window.location.assign('/'); else router.replace('/'); }} />
  </Card></View></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.cream }, page: { flex: 1, padding: 22, alignItems: 'center', justifyContent: 'center' }, card: { gap: 16, padding: 28, maxWidth: 520, width: '100%' }, title: { color: colors.ink, fontSize: 24, fontWeight: '900' }, text: { color: colors.inkSoft, fontSize: 16, lineHeight: 24 } });
