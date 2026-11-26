import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { pinPrefixPlace, searchPlaces, type Place, type PlaceKind } from '../lib/places';
import { colors, radius } from '../theme';
import { Field } from './kit';

type Props = {
  label: string; value: Place[]; onChange: (next: Place[]) => void;
  /** 1 = single choice (replaces the current one). */
  max?: number; kinds?: PlaceKind[]; placeholder?: string; hint?: string;
  /** Offer "All PIN codes starting with …" when digits are typed (search filters only). */
  allowPinPrefix?: boolean; ranked?: boolean;
};

/** Type-ahead for any place in India: state, district, city, area or PIN code. */
export function LocationPicker({ label, value, onChange, max = 1, kinds, placeholder = 'Type a city, area, district, state or PIN code', hint, allowPinPrefix = false, ranked = false }: Props) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const q = text.trim();
  useEffect(() => {
    const n = ++seq.current;
    if ((/^\d+$/.test(q) && q.length < 3) || q.length < 2) return;
    const timer = setTimeout(() => {
      searchPlaces(q, kinds).then((r) => { if (n === seq.current) { setResults(r); setError(null); } },
        () => { if (n === seq.current) setError('Could not search locations. Check your connection.'); });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, kinds]);
  const showResults = q.length >= 2 && !(/^\d+$/.test(q) && q.length < 3);

  const options = [
    ...(allowPinPrefix && /^[1-9]\d{0,5}$/.test(q) ? [pinPrefixPlace(q)] : []),
    ...(showResults ? results : []),
  ].filter((p) => !value.some((v) => v.id === p.id));

  function pick(p: Place) {
    const next = max === 1 ? [p] : [...value.filter((v) => !(p.kind === 'pin_prefix' && v.kind === 'pin_prefix')), p].slice(0, max);
    onChange(next); setText(''); setResults([]);
  }

  return <View style={styles.wrap}>
    <Field label={label} value={text} onChangeText={setText} placeholder={value.length >= max && max > 1 ? `Up to ${max} places` : placeholder}
      editable={max === 1 || value.length < max} hint={hint} error={error} autoCorrect={false} autoCapitalize="words" />
    {options.length > 0 && <View accessibilityRole="list" style={styles.list}>{options.slice(0, 10).map((p) =>
      <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={p.label} onPress={() => pick(p)} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
        <Ionicons name={p.kind === 'pin' || p.kind === 'pin_prefix' ? 'mail-outline' : p.kind === 'state' ? 'map-outline' : 'location-outline'} size={16} color={colors.inkSoft} />
        <Text style={styles.optionText}>{p.label}</Text></Pressable>)}</View>}
    {showResults && options.length === 0 && results.length === 0 && !error && <Text style={styles.none}>No matching place yet. Try the district, a nearby town or the PIN code.</Text>}
    {value.length > 0 && <View style={styles.chips}>{value.map((p, i) =>
      <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Remove ${p.label}`} onPress={() => onChange(value.filter((v) => v.id !== p.id))} style={styles.chip}>
        <Text style={styles.chipText}>{ranked ? `${i + 1}. ` : ''}{p.label}</Text><Ionicons name="close" size={14} color={colors.tealDark} /></Pressable>)}</View>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.surface, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.muted },
  pressed: { backgroundColor: colors.tealPale },
  optionText: { color: colors.ink, fontSize: 14, flex: 1 },
  none: { color: colors.inkSoft, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.tealPale },
  chipText: { color: colors.tealDark, fontSize: 13, fontWeight: '700' },
});
