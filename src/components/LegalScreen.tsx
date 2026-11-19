import { router } from 'expo-router';
import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { legalPages } from '../content/legal';
import { colors } from '../theme';
import { Card, Logo, PrimaryButton } from './ui';

export function LegalScreen({ page }: { page: keyof typeof legalPages }) {
  const content = legalPages[page];
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.head}><Logo /><PrimaryButton label="Home" variant="ghost" onPress={() => router.replace('/')} /></View>
    <Card style={{ gap: 18, padding: 28 }}><Text accessibilityRole="header" style={styles.title}>{content.title}</Text>
      <Text style={styles.draft}>This is a draft prepared for legal review. It is not yet a final legal document.</Text>
      {content.sections.map((s) => <View key={s.heading} style={{ gap: 6 }}><Text accessibilityRole="header" style={styles.h}>{s.heading}</Text><Text style={styles.p}>{s.body}</Text></View>)}
    </Card></ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.cream }, page: { width: '100%', maxWidth: 780, alignSelf: 'center', padding: 22, gap: 20 }, head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { color: colors.ink, fontSize: 30, fontWeight: '900' }, draft: { color: '#8A5B00', backgroundColor: colors.saffronPale, padding: 12, borderRadius: 12, fontWeight: '700' }, h: { color: colors.ink, fontSize: 18, fontWeight: '800' }, p: { color: colors.inkSoft, fontSize: 16, lineHeight: 25 } });
