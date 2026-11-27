import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React from 'react';
import { Linking, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Logo, PrimaryButton } from '../components/ui';
import { APK_URL, RELEASES_URL } from '../lib/app-download';
import { colors } from '../theme';

const steps = [
  'Tap "Download Android app". The file KaamSetu.apk downloads from our official GitHub release page.',
  'Open the downloaded file. If Android asks, allow your browser to "install unknown apps" for this one install.',
  'Tap Install, then open KaamSetu and sign in with the same account you use on this website.',
  'Updating later: download the latest file from this page and install it over the old app. Your account stays the same.',
];

export default function DownloadScreen() {
  const version = Constants.expoConfig?.version;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.head}><Logo /><PrimaryButton label="Home" variant="ghost" onPress={() => router.replace('/')} /></View>
    <Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>Get the KaamSetu app</Text>
      <Text style={styles.p}>Free for candidates and employers. The app and this website use the same account and show the same jobs.</Text>

      <View style={styles.block}>
        <View style={styles.row}><Ionicons name="logo-android" size={26} color={colors.teal} /><Text style={styles.h}>Android</Text>{version && <Text style={styles.small}>Version {version}</Text>}</View>
        <PrimaryButton label="Download Android app" icon="download-outline" onPress={() => void Linking.openURL(APK_URL)} />
        {steps.map((s, i) => <View key={i} style={styles.step}><Text style={styles.num}>{i + 1}</Text><Text style={[styles.p, { flex: 1 }]}>{s}</Text></View>)}
        <Text style={styles.small}>Only download KaamSetu from this page or our official release page. Checksums for each version are listed on the{' '}
          <Text style={styles.link} onPress={() => void Linking.openURL(RELEASES_URL)}>release page</Text>.</Text>
      </View>

      <View style={styles.block}>
        <View style={styles.row}><Ionicons name="logo-apple" size={26} color={colors.ink} /><Text style={styles.h}>iPhone and iPad</Text></View>
        <Text style={styles.p}>The iPhone app is not on the App Store yet. Use this website in Safari: it has every feature. To keep it on your home screen, tap Share, then “Add to Home Screen”.</Text>
        <PrimaryButton label="Open KaamSetu in the browser" variant="secondary" icon="globe-outline" onPress={() => router.push('/login')} />
      </View>

      <Text style={styles.small}>KaamSetu never asks candidates for money. If anyone asks you to pay for a job, report it in the app.</Text>
    </Card>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream }, page: { width: '100%', maxWidth: 780, alignSelf: 'center', padding: 22, gap: 20 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, card: { gap: 22, padding: 28 },
  title: { color: colors.ink, fontSize: 30, fontWeight: '900' }, h: { color: colors.ink, fontSize: 20, fontWeight: '900', flex: 1 },
  block: { gap: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 18 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, num: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.tealPale, color: colors.tealDark, textAlign: 'center', lineHeight: 26, fontWeight: '900' },
  p: { color: colors.inkSoft, fontSize: 16, lineHeight: 24 }, small: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 }, link: { color: colors.teal, fontWeight: '800' },
});
