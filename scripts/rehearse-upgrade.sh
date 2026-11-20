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
# Production-only environment differences (restricted default privileges, Supabase-managed event trigger), as superuser.
psql "${DB/postgres:postgres@/supabase_admin:postgres@}" -v ON_ERROR_STOP=1 -f scripts/rehearsal/prod-environment.sql
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/rehearsal/prod-event-trigger.sql
cp "${pending[@]}" "$W/supabase/migrations/"
supabase migration up --workdir "$W"
supabase migration list --workdir "$W"
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/rehearsal/v140-assertions.sql
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/production-checks.sql
# Supabase-managed DDL must still work after the migrations: the ensure_rls event trigger fires for every role's DDL,
# so its function must stay executable (a revoked PUBLIC EXECUTE would break Auth/Storage platform upgrades).
SA="${DB/postgres:postgres@/supabase_admin:postgres@}"
psql "$SA" -v ON_ERROR_STOP=1 -c "set role supabase_storage_admin" -c "create table storage.rehearsal_probe (id int)" -c "drop table storage.rehearsal_probe"
psql "$SA" -v ON_ERROR_STOP=1 -c "set role supabase_auth_admin" -c "create table auth.rehearsal_probe (id int)" -c "drop table auth.rehearsal_probe"
psql "$DB" -v ON_ERROR_STOP=1 -c "create table public.rehearsal_probe (id int)" -c "select relname, relrowsecurity from pg_class where relname = 'rehearsal_probe'" -c "drop table public.rehearsal_probe"
supabase stop --no-backup --workdir "$W"
