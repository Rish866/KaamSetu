// Pan-India places (states/UTs, districts, cities, localities and PIN codes) from public.locations.
import { placeLabel } from './place-label';
import { supabase } from './supabase';

export { placeLabel };

export type PlaceKind = 'state' | 'district' | 'city' | 'locality' | 'pin' | 'pin_prefix';
export type Place = { id: string; kind: PlaceKind; label: string };
type Row = { id: string; kind: string; city: string; locality: string | null; district: string | null; state: string; pincode: string | null };

export const PLACE_COLUMNS = 'id,kind,city,locality,district,state,pincode';
export const toPlace = (r: Row): Place => ({ id: r.id, kind: r.kind as PlaceKind, label: placeLabel(r) });

/** "All PIN codes starting with 400" as a search filter (not a stored place). */
export const pinPrefixPlace = (prefix: string): Place => ({ id: `pin:${prefix}`, kind: 'pin_prefix', label: `All PIN codes starting with ${prefix}` });
export const splitFilters = (places: Place[]) => ({
  places: places.filter((p) => p.kind !== 'pin_prefix').map((p) => p.id),
  pinPrefix: places.find((p) => p.kind === 'pin_prefix')?.id.slice(4) ?? null,
});

/** Loads places by id, keeping the given order (for saved preferences). */
export async function loadPlaces(ids: (string | null | undefined)[]): Promise<Place[]> {
  const want = ids.filter((x): x is string => Boolean(x));
  if (want.length === 0) return [];
  const { data, error } = await supabase.from('locations').select(PLACE_COLUMNS).in('id', want);
  if (error) throw error;
  const byId = new Map((data as Row[]).map((r) => [r.id, toPlace(r)]));
  return want.map((id) => byId.get(id)).filter((p): p is Place => Boolean(p));
}

export async function searchPlaces(query: string, kinds?: PlaceKind[]): Promise<Place[]> {
  const { data, error } = await supabase.rpc('search_locations', { p_query: query, p_kinds: kinds ?? null, p_limit: 12 });
  if (error) throw error;
  return ((data ?? []) as { id: string; kind: string; label: string }[]).map((r) => ({ id: r.id, kind: r.kind as PlaceKind, label: r.label }));
}

export const POPULAR_CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad'];
/** One place per popular city name (city or district rows only). */
export async function loadPopularCities(): Promise<Place[]> {
  const { data, error } = await supabase.from('locations').select(PLACE_COLUMNS).in('kind', ['district', 'city']).in('city', POPULAR_CITIES);
  if (error) throw error;
  const rows = (data as Row[]).sort((a, b) => (a.kind === 'city' ? -1 : 1) - (b.kind === 'city' ? -1 : 1));
  const first = new Map<string, Place>();
  for (const r of rows) if (!first.has(r.city)) first.set(r.city, { id: r.id, kind: r.kind as PlaceKind, label: r.city });
  return POPULAR_CITIES.map((c) => first.get(c)).filter((p): p is Place => Boolean(p));
}
