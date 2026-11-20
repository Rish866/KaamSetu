#!/usr/bin/env bash
# Upgrade rehearsal on a REAL local Supabase Postgres (never production):
#   1. start a database with only the migrations already applied in production (<= 202611190001),
#   2. create data the way the v1.3.0 app could,
#   3. apply the pending v1.4.0 migrations with the Supabase CLI (same mechanism as `db push`),
#   4. assert data survived and the new schema is correct, then run the production catalog checks.
set -euo pipefail
BASE_MAX=${BASE_MAX:-202611190001}
DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
W=$(mktemp -d)
mkdir -p "$W/supabase/migrations"
cp supabase/config.toml supabase/seed.sql "$W/supabase/"
pending=()
for f in supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -c1-12)
  if [ "$v" -le "$BASE_MAX" ]; then cp "$f" "$W/supabase/migrations/"; else pending+=("$f"); fi
done
echo "Base migrations: $(ls "$W/supabase/migrations" | tr '\n' ' ')"
echo "Pending migrations: ${pending[*]}"
supabase db start --workdir "$W"
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/rehearsal/v130-fixtures.sql
cp "${pending[@]}" "$W/supabase/migrations/"
supabase migration up --local --workdir "$W"
supabase migration list --local --workdir "$W"
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/rehearsal/v140-assertions.sql
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/production-checks.sql
supabase stop --no-backup --workdir "$W"
