import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Card, LinkButton, Logo, Pill, SectionTitle } from '../components/ui';
import { colors } from '../theme';

const matchFactors: [string, number][] = [['Skills and required capabilities', 35], ['Location and work mode', 25], ['Salary compatibility', 20], ['Experience fit', 15], ['Job freshness', 5]];

export default function HomeScreen() {
  const { width } = useWindowDimensions(); const desktop = width >= 820;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.header}><Logo />{desktop && <View style={styles.headerLinks}><Link href={{ pathname: '/login', params: { role: 'candidate' } }} style={styles.headerLink}>For candidates</Link><Link href={{ pathname: '/login', params: { role: 'employer' } }} style={styles.headerLink}>For employers</Link><Link href={{ pathname: '/login', params: { role: 'admin' } }} style={styles.headerLink}>Admin sign in</Link></View>}<LinkButton label="Sign in" href="/login" variant="secondary" /></View>
    <LinearGradient colors={['#171B3D', '#25275A', '#184B64']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, !desktop && styles.heroMobile]}>
      <View style={styles.heroGlowOne} /><View style={styles.heroGlowTwo} />
      <View style={styles.heroCopy}><Pill tone="saffron">Built for Mumbai, Thane & Pune</Pill><Text style={[styles.heroTitle, !desktop && styles.heroTitleMobile]}>Stop chasing jobs. Let the right work find you.</Text><Text style={styles.heroText}>KaamSetu connects skilled people with verified employers using transparent salaries, consent-first profiles, and explainable AI matching.</Text>
        <View style={styles.actions}><LinkButton label="I’m looking for work" href={{ pathname: '/login', params: { role: 'candidate' } }} /><LinkButton label="I’m hiring" href={{ pathname: '/login', params: { role: 'employer' } }} variant="secondary" /></View>
        <View style={styles.trustRow}><View style={styles.trustItem}><Ionicons name="shield-checkmark" size={18} color={colors.teal} /><Text style={styles.trustText}>Verified employers</Text></View><View style={styles.trustItem}><Ionicons name="eye-off" size={18} color={colors.teal} /><Text style={styles.trustText}>Contact details stay private</Text></View></View>
      </View>
      <View style={styles.matchPanel}><LinearGradient colors={['#7778FF', '#37C7D5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.panelAccent} /><Text style={styles.panelLabel}>How a match score works</Text><Text style={styles.jobTitle}>Five factors, shown in plain language</Text>
        <View style={styles.reasonBox}>{matchFactors.map(([label, weight]) => <View key={label} style={styles.reason}><Ionicons name="checkmark-circle" size={18} color={colors.success} /><Text style={styles.reasonText}>{label} ({weight}%)</Text></View>)}</View>
        <Text style={styles.safeCopy}>Scores never use your name, photo, gender, religion, caste, age, marital status or disability. You decide whether to apply. Nothing is sent automatically.</Text>
      </View>
    </LinearGradient>
    <View style={styles.section}><SectionTitle eyebrow="One marketplace, two directions" title="Candidates and companies meet in the middle" description="Candidates apply to suitable jobs. Verified employers invite interested candidates without seeing private details first." />
      <View style={[styles.featureGrid, !desktop && styles.stack]}>
        <Feature icon="person" title="For candidates" text="Upload once, confirm your details, see salary-compatible jobs, and track every response." href={{ pathname: '/login', params: { role: 'candidate' } }} label="Create candidate account" />
        <Feature icon="business" title="For employers" text="Publish salary-visible roles, review matched applicants, and invite consenting candidates." href={{ pathname: '/login', params: { role: 'employer' } }} label="Create employer account" tone="saffron" />
        <Feature icon="sparkles" title="AI with guardrails" text="Every score has reasons. AI helps people decide; it never secretly applies or rejects." label="Explainable by design" tone="coral" />
      </View>
    </View>
    <LinearGradient colors={['#171B3D', '#26285C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cta}><View style={styles.ctaOrb} /><View style={styles.ctaCopy}><Text style={styles.ctaTitle}>A better first step for every job search.</Text><Text style={styles.ctaText}>Create your secure candidate account to view jobs and manage applications.</Text></View><LinkButton label="Create candidate account" href={{ pathname: '/login', params: { role: 'candidate' } }} /></LinearGradient>
    <View style={styles.footerRow}><Text style={styles.footer}>KaamSetu by Aarvya Global Ventures LLP · Mumbai, Navi Mumbai, Thane and Pune</Text><Link href="/privacy" style={styles.footerLink}>Privacy</Link><Link href="/terms" style={styles.footerLink}>Terms</Link><Link href="/support" style={styles.footerLink}>Support</Link></View>
  </ScrollView></SafeAreaView>;
}

function Feature({ icon, title, text, href, label, tone = 'teal' }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string; href?: React.ComponentProps<typeof Link>['href']; label: string; tone?: 'teal' | 'saffron' | 'coral' }) {
  const bg = tone === 'saffron' ? colors.saffronPale : tone === 'coral' ? '#FCE2DA' : colors.tealPale;
  const fg = tone === 'saffron' ? '#8A5B00' : tone === 'coral' ? colors.coral : colors.teal;
  const content = <><View style={[styles.featureIcon, { backgroundColor: bg }]}><Ionicons name={icon} size={23} color={fg} /></View><Text style={styles.featureTitle}>{title}</Text><Text style={styles.featureText}>{text}</Text><View style={styles.inlineLink}><Text style={styles.inlineLinkText}>{label}</Text><Ionicons name={href ? 'arrow-forward' : 'shield-checkmark'} size={16} color={colors.teal} /></View></>;
  return <Card style={styles.featureCard}>{href ? <Link href={href} asChild><Pressable style={styles.featureInner}>{content}</Pressable></Link> : content}</Card>;
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, justifyContent: 'center', alignItems: 'center', paddingTop: 24 }, footerLink: { color: colors.teal, fontWeight: '800', fontSize: 13 },
  safe: { flex: 1, backgroundColor: '#FFFFFF' }, page: { paddingHorizontal: 22, paddingBottom: 32, maxWidth: 1280, width: '100%', alignSelf: 'center' },
  header: { minHeight: 90, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18 }, headerLinks: { flexDirection: 'row', gap: 30, flex: 1, justifyContent: 'center' }, headerLink: { color: colors.inkSoft, fontWeight: '700' },
  hero: { minHeight: 640, borderRadius: 38, padding: 58, flexDirection: 'row', alignItems: 'center', gap: 52, overflow: 'hidden' }, heroMobile: { padding: 24, paddingVertical: 40, flexDirection: 'column', alignItems: 'stretch' },
  heroGlowOne: { position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(115,116,255,0.22)', right: -80, top: -150 }, heroGlowTwo: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(41,196,216,0.15)', left: -110, bottom: -150 },
  heroCopy: { flex: 1, gap: 22, zIndex: 1 }, heroTitle: { color: '#FFFFFF', fontSize: 60, lineHeight: 64, letterSpacing: -2.8, fontWeight: '900', maxWidth: 680 }, heroTitleMobile: { fontSize: 40, lineHeight: 44, letterSpacing: -1.7 }, heroText: { color: '#C8CEE0', fontSize: 18, lineHeight: 29, maxWidth: 620 },
  actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, trustRow: { flexDirection: 'row', gap: 20, flexWrap: 'wrap' }, trustItem: { flexDirection: 'row', gap: 7, alignItems: 'center' }, trustText: { color: '#D9DEEA', fontSize: 13, fontWeight: '700' },
  matchPanel: { flex: 0.75, minWidth: 280, maxWidth: 440, backgroundColor: colors.surface, borderRadius: 30, padding: 28, paddingTop: 32, gap: 14, shadowColor: '#050718', shadowOpacity: 0.28, shadowRadius: 40, shadowOffset: { width: 0, height: 22 }, elevation: 10, transform: [{ rotate: '1deg' }], overflow: 'hidden', zIndex: 2 }, panelAccent: { position: 'absolute', left: 0, right: 0, top: 0, height: 7 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, panelLabel: { color: colors.inkSoft, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '900' }, jobTitle: { color: colors.ink, fontSize: 26, lineHeight: 31, fontWeight: '900', letterSpacing: -0.7 }, company: { color: colors.inkSoft, lineHeight: 21 },
  salaryRow: { backgroundColor: colors.saffronPale, borderRadius: 14, padding: 14, flexDirection: 'row', gap: 9, alignItems: 'center' }, salary: { color: colors.ink, fontWeight: '900' }, reasonBox: { gap: 10, marginVertical: 3 }, reason: { flexDirection: 'row', alignItems: 'center', gap: 8 }, reasonText: { color: colors.inkSoft, flex: 1, fontSize: 13, lineHeight: 19 }, miniBar: { height: 7, borderRadius: 9, backgroundColor: colors.muted, overflow: 'hidden' }, miniBarFill: { width: '92%', height: '100%', backgroundColor: colors.teal, borderRadius: 9 }, safeCopy: { color: colors.inkSoft, fontSize: 11, lineHeight: 16 },
  liveBadge: { position: 'absolute', right: 54, top: 54, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 5 }, liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }, liveText: { color: colors.ink, fontSize: 11, fontWeight: '800' }, profileBadge: { position: 'absolute', right: 320, bottom: 38, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9, zIndex: 5 }, avatarStack: { flexDirection: 'row' }, miniAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }, avatarOverlap: { marginLeft: -8 }, avatarLetter: { color: colors.ink, fontSize: 10, fontWeight: '900' }, profileText: { color: colors.ink, fontSize: 10, fontWeight: '800' },
  section: { paddingVertical: 86, gap: 36 }, featureGrid: { flexDirection: 'row', gap: 18 }, stack: { flexDirection: 'column' }, featureCard: { flex: 1, gap: 14, minHeight: 260, borderColor: '#ECEEF5' }, featureInner: { flex: 1, gap: 14 }, featureIcon: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, featureTitle: { color: colors.ink, fontSize: 21, fontWeight: '900', letterSpacing: -0.4 }, featureText: { color: colors.inkSoft, lineHeight: 24, flex: 1 }, inlineLink: { flexDirection: 'row', alignItems: 'center', gap: 7 }, inlineLinkText: { color: colors.teal, fontWeight: '900', fontSize: 13 },
  cta: { borderRadius: 30, padding: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', overflow: 'hidden' }, ctaOrb: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: 'rgba(105,106,239,0.20)', right: 110, top: -100 }, ctaCopy: { gap: 7, flex: 1, minWidth: 240, zIndex: 1 }, ctaTitle: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.8 }, ctaText: { color: '#C8CEE0' }, footer: { color: colors.inkSoft, textAlign: 'center', paddingTop: 30, fontSize: 12 },
});
