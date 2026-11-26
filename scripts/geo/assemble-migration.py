#!/usr/bin/env python3
"""Assembles supabase/migrations/202611260001_pan_india_locations.sql from
   scripts/geo/migration-head.sql + generated data + scripts/geo/migration-tail.sql.
private.match_score is copied verbatim from migration 202611200001 with only the location explanation replaced, so the
score itself is unchanged. Run once before release; the migration must never be edited after it is applied.
  python3 scripts/geo/assemble-migration.py data.sql
"""
import re, sys
root = 'supabase/migrations/'
src = open(root + '202611200001_security_foundation.sql').read()
start = src.index('create or replace function private.match_score(')
end = src.index('end $$;', start) + len('end $$;')
ms = src[start:end]
old = """  s_loc := private.score_location(p_candidate, p_job);"""
assert old in ms
ms = ms.replace(old, """  loc := private.location_fit(p_candidate, p_job);
  s_loc := (loc->>'score')::numeric;""")
ms = ms.replace("  total numeric; avail numeric := 0; reasons text[] := '{}'; open_job boolean;",
                "  total numeric; avail numeric := 0; reasons text[] := '{}'; open_job boolean; loc jsonb;")
old_expl = re.search(r"        'explanation', case when j\.work_mode = 'remote' then 'This job is remote\.'.*?end\),\n", ms, re.S).group(0)
new_expl = """        'tier', loc->>'tier',
        'explanation', case when j.work_mode = 'remote' then 'This job is remote, open to candidates anywhere in India.'
          when s_loc is null then 'Add a current or preferred location to improve this score.'
          else case loc->>'tier'
            when 'area' then 'The job is in an area you chose.'
            when 'city' then 'The job is in a city you prefer.'
            when 'district' then 'The job is in a district you prefer, outside your chosen city.'
            when 'state' then 'The job is in a state you are open to.'
            else 'The job is outside the places you prefer.' end
            || case when coalesce((loc->>'rank')::int, 1) > 1 and loc->>'tier' <> 'none' then ' It matches a lower-ranked preference.' else '' end
          end),
"""
ms = ms.replace(old_expl, new_expl)
assert "location_fit" in ms and "lower-ranked preference" in ms
head = open('scripts/geo/migration-head.sql').read()
tail = open('scripts/geo/migration-tail.sql').read().replace('-- @@MATCH_SCORE@@', ms)
data = open(sys.argv[1]).read()
open(root + '202611260001_pan_india_locations.sql', 'w').write(head + '\n' + data + tail)
print('wrote', root + '202611260001_pan_india_locations.sql')
