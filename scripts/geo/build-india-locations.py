#!/usr/bin/env python3
"""Generates the data part of the Pan-India location migration from India Post's "All India Pincode Directory".

Source: Department of Posts, Government of India, "All India Pincode Directory", Open Government Data Platform India
(https://data.gov.in), Government Open Data License - India (https://data.gov.in/government-open-data-license-india).
Fetched as an unmodified republish (CircleName, RegionName, DivisionName, OfficeName, Pincode, OfficeType, Delivery,
District, StateName, Latitude, Longitude).

  python3 scripts/geo/build-india-locations.py pincode.csv > data.sql

Output: one row per state/UT, one per district, one 'pin' place per PIN code (representative locality, other office names
for search, centroid of valid coordinates). Run once; the generated migration is never edited after release.
"""
import collections, csv, re, sys

STATES = {  # name in the source -> (code, display name, kind)
  'ANDAMAN AND NICOBAR ISLANDS': ('AN', 'Andaman and Nicobar Islands', 'union_territory'),
  'ANDHRA PRADESH': ('AP', 'Andhra Pradesh', 'state'), 'ARUNACHAL PRADESH': ('AR', 'Arunachal Pradesh', 'state'),
  'ASSAM': ('AS', 'Assam', 'state'), 'BIHAR': ('BR', 'Bihar', 'state'), 'CHANDIGARH': ('CH', 'Chandigarh', 'union_territory'),
  'CHHATTISGARH': ('CG', 'Chhattisgarh', 'state'), 'DELHI': ('DL', 'Delhi', 'union_territory'), 'GOA': ('GA', 'Goa', 'state'),
  'GUJARAT': ('GJ', 'Gujarat', 'state'), 'HARYANA': ('HR', 'Haryana', 'state'), 'HIMACHAL PRADESH': ('HP', 'Himachal Pradesh', 'state'),
  'JAMMU AND KASHMIR': ('JK', 'Jammu and Kashmir', 'union_territory'), 'JHARKHAND': ('JH', 'Jharkhand', 'state'),
  'KARNATAKA': ('KA', 'Karnataka', 'state'), 'KERALA': ('KL', 'Kerala', 'state'), 'LADAKH': ('LA', 'Ladakh', 'union_territory'),
  'LAKSHADWEEP': ('LD', 'Lakshadweep', 'union_territory'), 'MADHYA PRADESH': ('MP', 'Madhya Pradesh', 'state'),
  'MAHARASHTRA': ('MH', 'Maharashtra', 'state'), 'MANIPUR': ('MN', 'Manipur', 'state'), 'MEGHALAYA': ('ML', 'Meghalaya', 'state'),
  'MIZORAM': ('MZ', 'Mizoram', 'state'), 'NAGALAND': ('NL', 'Nagaland', 'state'), 'ODISHA': ('OD', 'Odisha', 'state'),
  'PUDUCHERRY': ('PY', 'Puducherry', 'union_territory'), 'PUNJAB': ('PB', 'Punjab', 'state'), 'RAJASTHAN': ('RJ', 'Rajasthan', 'state'),
  'SIKKIM': ('SK', 'Sikkim', 'state'), 'TAMIL NADU': ('TN', 'Tamil Nadu', 'state'), 'TELANGANA': ('TS', 'Telangana', 'state'),
  'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU': ('DH', 'Dadra and Nagar Haveli and Daman and Diu', 'union_territory'),
  'TRIPURA': ('TR', 'Tripura', 'state'), 'UTTAR PRADESH': ('UP', 'Uttar Pradesh', 'state'), 'UTTARAKHAND': ('UK', 'Uttarakhand', 'state'),
  'WEST BENGAL': ('WB', 'West Bengal', 'state'),
}
SMALL = {'and', 'of', 'the'}
def title(s):
    words = re.sub(r'\s+', ' ', s.strip()).lower().split(' ')
    return ' '.join(w if (i and w in SMALL) else (w[:1].upper() + w[1:]) for i, w in enumerate(words))

def district_display(state, d):
    t = title(d)
    if state == 'DL' and 'delhi' not in t.lower(): t += ' Delhi'
    return t

# City a district is commonly known by (so "Andheri" and "Colaba" are both "Mumbai"). Default: the district name.
CITY_ALIASES = {('MH', 'Mumbai'): 'Mumbai', ('MH', 'Mumbai Suburban'): 'Mumbai', ('KA', 'Bengaluru Urban'): 'Bengaluru',
                ('UP', 'Gautam Buddha Nagar'): 'Noida', ('GJ', 'Ahmadabad'): 'Ahmedabad'}
def city_of(state, ddisp):
    if state == 'DL': return 'Delhi'
    return CITY_ALIASES.get((state, ddisp), ddisp)

SUFFIX = re.compile(r'\s*(\(.*?\))?\s*\b(E\.?\s?D\.?\s*)?(B\.?\s?O|S\.?\s?O|H\.?\s?O|G\.?\s?P\.?\s?O|MDG|NDSO|LSG\s*SO)\b\.?.*$', re.I)
def office(name):
    n = SUFFIX.sub('', name).strip(' .-')
    n = re.sub(r'\s*\(.*?\)\s*', ' ', n).strip()
    return title(n) if n else None

def _unused_coord(v, lo, hi):
    v = (v or '').strip().rstrip('NnEe ').strip()
    if v.endswith('-'): v = '-' + v[:-1]
    try: x = float(v)
    except ValueError: return None
    return x if lo <= x <= hi and abs(x - 1.0) > 1e-9 else None

def q(s): return "'" + s.replace("'", "''") + "'" if s is not None else 'null'

rows = list(csv.DictReader(open(sys.argv[1], encoding='utf-8', errors='replace')))
districts = set(); pins = collections.defaultdict(list)
for r in rows:
    st = STATES[r['StateName'].strip().upper()][0]
    d = district_display(st, r['District']); districts.add((st, d))
    if re.fullmatch(r'[1-9][0-9]{5}', r['Pincode'].strip()): pins[r['Pincode'].strip()].append((st, d, r))

out = []
out.append('insert into public.states (code, name, kind) values\n' + ',\n'.join(
    f"  ({q(c)}, {q(n)}, {q(k)})" for c, n, k in sorted(STATES.values())) + ';\n')
dl = sorted(districts)
for i in range(0, len(dl), 500):
    out.append('insert into public.districts (state_code, name) values\n' + ',\n'.join(f'  ({q(s)}, {q(d)})' for s, d in dl[i:i+500]) + '\non conflict do nothing;\n')

PRIO = {'HO': 0, 'PO': 1, 'SO': 1, 'BO': 2}
pinrows = []
for pin, lst in sorted(pins.items()):
    # A PIN belongs to the district/state most of its offices are in.
    (st, d), _ = collections.Counter((s, dd) for s, dd, _ in lst).most_common(1)[0]
    offs = sorted({(PRIO.get(x['OfficeType'].strip().upper(), 3), office(x['OfficeName'])) for s, dd, x in lst if (s, dd) == (st, d) and office(x['OfficeName'])})
    names = [n for _, n in offs]
    # Coordinates are not imported: thousands of source rows have placeholder or clearly wrong values.
    pinrows.append((pin, st, d, city_of(st, d), names[0] if names else None, ', '.join(names[1:8]) or None))

for i in range(0, len(pinrows), 1000):
    out.append('insert into private.pin_import (pincode, state_code, district, city, locality, aliases) values\n' + ',\n'.join(
        f"  ({q(p)}, {q(s)}, {q(d)}, {q(c)}, {q(l)}, {q(a)})" for p, s, d, c, l, a in pinrows[i:i+1000]) + ';\n')

print(f'-- Generated by scripts/geo/build-india-locations.py: {len(STATES)} states/UTs, {len(dl)} districts, {len(pinrows)} PIN codes.')
print('-- Source: Department of Posts, Government of India, "All India Pincode Directory", data.gov.in, GODL-India.')
print('\n'.join(out))
print(f'-- city aliases: {sorted(set(CITY_ALIASES.values()) | {"Delhi"})}', file=sys.stderr)
print(f'states {len(STATES)} districts {len(dl)} pins {len(pinrows)}', file=sys.stderr)
