#!/usr/bin/env bash
# Backup restore drill. Decrypts an encrypted production backup (schema, data, roles) and restores it into a brand-new,
# empty Supabase database on this machine, using Supabase's documented restore sequence, then proves the restore is
# complete: every table's row count must equal the number of rows in the backup file, the schema version must match,
# and the production catalog checks (RLS, grants, private buckets) must pass on the restored copy.
# Prints table names and counts only, never row contents. Plaintext dumps are shredded on exit.
#   BACKUP_PASSPHRASE=... scripts/restore-drill.sh <dir containing *-schema.sql.gpg, *-data.sql.gpg, *-roles.sql.gpg>
set -euo pipefail
dir="$(cd "$1" && pwd)"; repo="$(pwd)"
work="$(mktemp -d)"; trap 'find "$work" -name "*.sql" -exec shred -u {} + 2>/dev/null || true; (cd "$work/project" 2>/dev/null && supabase stop --no-backup >/dev/null 2>&1) || true' EXIT
start=$(date +%s)

(cd "$dir" && [ -f SHA256SUMS.txt ] && sha256sum -c SHA256SUMS.txt) || echo "::warning::no SHA256SUMS.txt to verify against"
for kind in roles schema data; do
  f=$(ls "$dir"/*-"$kind".sql.gpg | head -1)
  echo "$BACKUP_PASSPHRASE" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 --decrypt -o "$work/$kind.sql" "$f"
done
echo "backup: $(basename "$(ls "$dir"/*-schema.sql.gpg | head -1)" -schema.sql.gpg)"

# A new empty project: fresh `supabase init`, none of this repository's migrations.
mkdir -p "$work/project" && cd "$work/project" && supabase init --force >/dev/null && supabase db start
db="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# Default privileges FIRST. A new Supabase project grants ALL on new tables, functions and sequences to anon,
# authenticated and service_role; pg_dump only records grants relative to Postgres' built-in defaults and writes its
# ALTER DEFAULT PRIVILEGES at the end. Restored without this step, anon could execute every admin and worker function
# (found by the first drill, run 44867383491). Supabase documents the same requirement under `supabase db dump`.
{
  for kind in TABLES FUNCTIONS SEQUENCES; do
    echo "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON $kind FROM anon, authenticated, service_role;"
  done
  grep -E '^ALTER DEFAULT PRIVILEGES FOR ROLE "postgres"' "$work/schema.sql" || true
} > "$work/default-privileges.sql"
echo "default-privilege statements applied before the schema: $(wc -l < "$work/default-privileges.sql")"

# COPY dumps contain a block for every table, including empty Supabase-managed ones the project's postgres role may not
# write to (e.g. storage.buckets_vectors: "permission denied"). Empty blocks restore nothing, so drop them.
awk '
  /^COPY / { hdr=$0; buf=""; n=0; inblk=1; next }
  inblk && /^\\\.$/ { if (n > 0) { print hdr; printf "%s", buf; print "\\." } else { skipped++ } inblk=0; next }
  inblk { buf = buf $0 "\n"; n++; next }
  { print }
  END { print "-- empty COPY blocks dropped: " skipped+0 > "/dev/stderr" }' "$work/data.sql" > "$work/data-nonempty.sql"
mv "$work/data-nonempty.sql" "$work/data.sql"

# Then Supabase's documented sequence (supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
psql "$db" --quiet --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$work/roles.sql" --file "$work/default-privileges.sql" --file "$work/schema.sql" \
  --command 'SET session_replication_role = replica' --file "$work/data.sql" >/dev/null
restored=$(date +%s)

# Expected rows per table, straight from the COPY blocks of the data dump.
# Handles both dump styles: COPY blocks (--use-copy) and one INSERT statement per row (the CLI default). A multi-row
# INSERT would under-count and show up as a mismatch, i.e. the drill fails loudly rather than passing wrongly.
awk '
  /^COPY /                 { t=$2; inblk=1; next }
  inblk && /^\\\.$/        { inblk=0; next }
  inblk                    { n[t]++; next }
  /^INSERT INTO /          { t=$3; n[t]++ }
  END                      { for (k in n) print k" "n[k] }' "$work/data.sql" | sort > "$work/expected.txt"
grep -q '^COPY ' "$work/data.sql" || { echo "::error::This backup was written with INSERT statements, so its row counts cannot be checked exactly. Take a new backup (backups now use --use-copy) and rerun the drill."; exit 1; }
fail=0; tables=0; rows=0
while read -r t n; do
  got=$(psql "$db" -At -c "select count(*) from $t")
  tables=$((tables+1)); rows=$((rows+n))
  if [ "$got" != "$n" ]; then echo "MISMATCH $t backup=$n restored=$got"; fail=1; fi
done < "$work/expected.txt"
echo "tables with data in backup: $tables, rows: $rows, all counts equal: $([ $fail = 0 ] && echo yes || echo NO)"
grep -E '^"?(public|auth)"?\.' "$work/expected.txt" | grep -E 'profiles|companies|jobs|applications|resumes|consent_records|users' | sed 's/^/  /' || true

sv=$(psql "$db" -At -c "select public.schema_version()" 2>/dev/null || echo missing)
echo "restored schema_version: $sv (expected ${EXPECT_SCHEMA:-any})"
if [ -n "${EXPECT_SCHEMA:-}" ] && [ "$sv" != "$EXPECT_SCHEMA" ]; then fail=1; fi

psql "$db" -v ON_ERROR_STOP=1 -f "$repo/scripts/production-checks.sql" >/dev/null && echo "catalog checks on restored copy: passed" || { echo "catalog checks on restored copy: FAILED"; fail=1; }

echo "duration: restore $((restored-start)) s, total $(( $(date +%s)-start )) s"
[ "$fail" = 0 ] && echo "RESTORE DRILL PASSED" || { echo "::error::RESTORE DRILL FAILED"; exit 1; }
