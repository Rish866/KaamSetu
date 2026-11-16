import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, Link } from 'expo-router';
import React, { PropsWithChildren } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, shadow } from '../theme';

export function Logo({ compact = false, inverted = false }: { compact?: boolean; inverted?: boolean }) {
  return <View style={styles.logoRow}><LinearGradient colors={['#7778FF', '#4A4BD4', '#22BFD4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logoMark}><Text style={styles.logoLetter}>K</Text></LinearGradient>{!compact && <Text style={[styles.logoText, inverted && styles.logoTextInverted]}>KaamSetu</Text>}</View>;
}

export function Pill({ children, tone = 'teal' }: PropsWithChildren<{ tone?: 'teal' | 'saffron' | 'neutral' | 'coral' }>) {
  return <View style={[styles.pill, styles[`pill_${tone}`]]}><Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{children}</Text></View>;
}

export function PrimaryButton({ label, onPress, icon, disabled = false, variant = 'primary', style }: { label: string; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; variant?: 'primary' | 'secondary' | 'ghost'; style?: StyleProp<ViewStyle> }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, styles[`button_${variant}`], disabled && styles.buttonDisabled, pressed && !disabled && styles.pressed, style]}>
    {variant === 'primary' && !disabled && <LinearGradient colors={['#6768ED', '#4B4CD0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonGradient} />}
    {icon && <Ionicons name={icon} size={18} color={variant === 'primary' ? '#fff' : colors.teal} />}
    <Text style={[styles.buttonText, variant !== 'primary' && styles.buttonTextAlt]}>{label}</Text>
  </Pressable>;
}

export function LinkButton({ label, href, variant = 'primary' }: { label: string; href: Href; variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <Link href={href} asChild><Pressable style={StyleSheet.flatten([styles.button, styles[`button_${variant}`]])}>
    {variant === 'primary' && <LinearGradient colors={['#6768ED', '#4B4CD0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonGradient} />}
    <Text style={[styles.buttonText, variant !== 'primary' && styles.buttonTextAlt]}>{label}</Text><Ionicons name="arrow-forward" size={17} color={variant === 'primary' ? '#fff' : colors.teal} />
  </Pressable></Link>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return <View style={styles.sectionTitle}>{eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}<Text style={styles.h2}>{title}</Text>{description && <Text style={styles.description}>{description}</Text>}</View>;
}

export function Metric({ label, value, icon, accent = colors.tealPale }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; accent?: string }) {
  return <Card style={styles.metric}><View style={styles.metricGlow} /><View style={[styles.metricIcon, { backgroundColor: accent }]}><Ionicons name={icon} size={20} color={colors.tealDark} /></View><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></Card>;
}

const styles = StyleSheet.create({
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', shadowColor: '#5B5CE2', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  logoLetter: { color: '#fff', fontSize: 22, fontWeight: '900' }, logoText: { color: colors.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.8 }, logoTextInverted: { color: '#FFFFFF' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  pill_teal: { backgroundColor: colors.tealPale }, pill_saffron: { backgroundColor: colors.saffronPale }, pill_neutral: { backgroundColor: colors.muted }, pill_coral: { backgroundColor: '#FCE2DA' },
  pillText: { fontSize: 12, fontWeight: '800' }, pillText_teal: { color: colors.tealDark }, pillText_saffron: { color: '#8A5B00' }, pillText_neutral: { color: colors.inkSoft }, pillText_coral: { color: '#9D432E' },
  button: { minHeight: 48, borderRadius: 15, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, overflow: 'hidden' },
  buttonGradient: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  button_primary: { backgroundColor: colors.teal, shadowColor: colors.teal, shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3 }, button_secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#D6D8E8' }, button_ghost: { backgroundColor: colors.tealPale },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '800' }, buttonTextAlt: { color: colors.tealDark }, buttonDisabled: { backgroundColor: '#9EB7B3' }, pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 20, ...shadow },
  sectionTitle: { maxWidth: 650, gap: 8 }, eyebrow: { color: colors.teal, textTransform: 'uppercase', letterSpacing: 1.3, fontSize: 12, fontWeight: '900' },
  h2: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: '900', letterSpacing: -1 }, description: { color: colors.inkSoft, fontSize: 16, lineHeight: 24 },
  metric: { flex: 1, minWidth: 145, gap: 6, padding: 18, overflow: 'hidden' }, metricGlow: { position: 'absolute', width: 70, height: 70, borderRadius: 35, right: -20, top: -24, backgroundColor: '#F1F0FF' }, metricIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  metricValue: { color: colors.ink, fontSize: 26, fontWeight: '900' }, metricLabel: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
});
