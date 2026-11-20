import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, Link, router, usePathname } from 'expo-router';
import React, { PropsWithChildren, useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/AuthContext';
import { colors } from '../theme';
import { Logo, Pill } from './ui';

type NavItem = { label: string; href: Href; icon: keyof typeof Ionicons.glyphMap };
const candidateNav: NavItem[] = [
  { label: 'Jobs', href: '/candidate', icon: 'briefcase-outline' },
  { label: 'Applications', href: '/candidate/applications', icon: 'paper-plane-outline' },
  { label: 'Profile', href: '/candidate/profile', icon: 'person-outline' },
  { label: 'Alerts', href: '/candidate/notifications', icon: 'notifications-outline' },
  { label: 'Settings', href: '/candidate/settings', icon: 'settings-outline' },
];
const employerNav: NavItem[] = [
  { label: 'Overview', href: '/employer', icon: 'grid-outline' },
  { label: 'Jobs', href: '/employer/jobs', icon: 'briefcase-outline' },
  { label: 'Discover', href: '/employer/discover', icon: 'search-outline' },
  { label: 'Team', href: '/employer/team', icon: 'people-outline' },
  { label: 'Alerts', href: '/employer/notifications', icon: 'notifications-outline' },
  { label: 'Settings', href: '/employer/settings', icon: 'settings-outline' },
];
const adminNav: NavItem[] = [{ label: 'Admin', href: '/admin', icon: 'shield-checkmark-outline' }];

export function AppShell({ children, title, subtitle, role }: PropsWithChildren<{ title: string; subtitle: string; role: string }>) {
  const pathname = usePathname();
  const { access, signOut } = useAuth();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const allowedNavigation = pathname.startsWith('/admin') ? adminNav : access?.account_kind === 'employer' ? employerNav : candidateNav;
  const activeHref = [...allowedNavigation].sort((x, y) => String(y.href).length - String(x.href).length).find((i) => pathname === i.href || pathname.startsWith(`${String(i.href)}/`))?.href;
  const [unread, setUnread] = useState(0);
  useEffect(() => { void supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).then(({ count }) => setUnread(count ?? 0)); }, [pathname]);
  const alertsHref: Href = access?.account_kind === 'employer' ? '/employer/notifications' : '/candidate/notifications';
  const initials = access?.display_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'KS';
  async function logOut() { await signOut(); router.replace('/login'); }
  return <SafeAreaView style={styles.safe}><View style={styles.shell}>
    {desktop && <LinearGradient colors={['#191D3E', '#11152D', '#0E1A30']} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.sidebar}>
      <Link href="/" asChild><Pressable><Logo inverted /></Pressable></Link>
      <View style={styles.sideNav}>{allowedNavigation.map((item) => {
        const active = item.href === activeHref;
        return <Link href={item.href} asChild key={item.label}><Pressable style={StyleSheet.flatten([styles.navItem, active && styles.navItemActive])}>
          <View style={[styles.navIcon, active && styles.navIconActive]}><Ionicons name={item.icon} size={19} color={active ? '#FFFFFF' : '#9FA6BF'} /></View>
          <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>{active && <View style={styles.activeDot} />}
        </Pressable></Link>;
      })}</View>
      <View style={styles.privacyCard}><View style={styles.privacyIcon}><Ionicons name="lock-closed" size={17} color="#B4B6FF" /></View><Text style={styles.privacyTitle}>Privacy first</Text><Text style={styles.privacyText}>Contact details stay hidden until the candidate agrees.</Text><View style={styles.secureRow}><View style={styles.secureDot} /><Text style={styles.secureText}>Secure by design</Text></View></View>
    </LinearGradient>}
    <View style={styles.main}>
      <View style={styles.topbar}>
        {!desktop && <Link href="/" asChild><Pressable><Logo compact /></Pressable></Link>}
        <View style={styles.titleWrap}><Pill tone="neutral">{role}</Pill><Text style={styles.pageTitle}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
        <View style={styles.topActions}><Link href={alertsHref} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Notifications, ${unread} unread`} style={styles.bell}><Ionicons name="notifications-outline" size={20} color={colors.ink} />{unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>}</Pressable></Link><LinearGradient colors={['#FFF0D1', '#FFD89A']} style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></LinearGradient><Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={logOut} style={styles.logout}><Ionicons name="log-out-outline" size={20} color={colors.ink} /></Pressable></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>{children}</ScrollView>
      {!desktop && <View style={styles.bottomNav}>{allowedNavigation.map((item) => {
        const active = item.href === activeHref;
        return <Link href={item.href} asChild key={item.label}><Pressable style={styles.bottomItem}><View style={[styles.bottomIcon, active && styles.bottomIconActive]}><Ionicons name={item.icon} size={20} color={active ? colors.teal : colors.inkSoft} /></View><Text style={[styles.bottomText, active && styles.bottomTextActive]}>{item.label}</Text></Pressable></Link>;
      })}</View>}
    </View>
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.coral, right: 4, top: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, badgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  safe: { flex: 1, backgroundColor: colors.cream }, shell: { flex: 1, flexDirection: 'row' }, main: { flex: 1 },
  sidebar: { width: 252, padding: 24, justifyContent: 'space-between' }, sideNav: { flex: 1, marginTop: 52, gap: 9 },
  navItem: { minHeight: 52, paddingHorizontal: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 11 }, navItemActive: { backgroundColor: 'rgba(117,118,255,0.18)', borderWidth: 1, borderColor: 'rgba(174,176,255,0.16)' },
  navIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, navIconActive: { backgroundColor: 'rgba(255,255,255,0.11)' }, navText: { color: '#9FA6BF', fontWeight: '700', flex: 1 }, navTextActive: { color: '#FFFFFF' }, activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#6FE4ED' },
  privacyCard: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 22, padding: 17, gap: 8 }, privacyIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(117,118,255,0.18)', alignItems: 'center', justifyContent: 'center' }, privacyTitle: { color: '#FFFFFF', fontWeight: '900' }, privacyText: { color: '#9FA6BF', fontSize: 12, lineHeight: 18 }, secureRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }, secureDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#61D9B4' }, secureText: { color: '#BFC4D6', fontSize: 10, fontWeight: '700' },
  topbar: { paddingHorizontal: 28, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: 'rgba(255,255,255,0.94)', flexDirection: 'row', alignItems: 'center', gap: 16 }, titleWrap: { flex: 1, gap: 3 }, pageTitle: { color: colors.ink, fontWeight: '900', fontSize: 23, letterSpacing: -0.6 }, subtitle: { color: colors.inkSoft, fontSize: 13 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, searchHint: { height: 42, minWidth: 186, borderRadius: 14, backgroundColor: colors.muted, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, searchText: { color: colors.inkSoft, fontSize: 13, flex: 1 }, keyHint: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7, backgroundColor: '#FFFFFF' }, keyText: { color: colors.inkSoft, fontSize: 10, fontWeight: '700' },
  bell: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' }, notificationDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: colors.coral, right: 9, top: 9, borderWidth: 1.5, borderColor: '#fff' }, avatar: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#8A5B00', fontWeight: '900' }, logout: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 28, paddingBottom: 110, gap: 22, maxWidth: 1240, width: '100%', alignSelf: 'center' },
  bottomNav: { position: 'absolute', bottom: 10, left: 12, right: 12, minHeight: 68, backgroundColor: 'rgba(255,255,255,0.97)', borderWidth: 1, borderColor: colors.line, borderRadius: 22, flexDirection: 'row', paddingBottom: 5, shadowColor: colors.navy, shadowOpacity: 0.14, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 8 }, bottomItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }, bottomIcon: { width: 32, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, bottomIconActive: { backgroundColor: colors.tealPale }, bottomText: { color: colors.inkSoft, fontSize: 10, fontWeight: '700' }, bottomTextActive: { color: colors.teal },
});
