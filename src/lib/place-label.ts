// Pure helper (no network): wording must stay identical to private.location_label() in the database.
export type PlaceRow = { kind: string; city: string; locality: string | null; district: string | null; state: string; pincode: string | null };
/** Same wording as private.location_label() in the database. */
export function placeLabel(r: PlaceRow): string {
  if (r.kind === 'state') return `${r.state} (entire state)`;
  if (r.kind === 'pin') return `${r.pincode} · ${r.locality ? `${r.locality}, ` : ''}${r.city}, ${r.state}`;
  if (r.kind === 'locality') return `${r.locality}, ${r.city}, ${r.state}`;
  return `${r.city}${r.district && r.district !== r.city ? ` (${r.district})` : ''}, ${r.state}`;
}
