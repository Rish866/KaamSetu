# Backup restore drills

| Date (UTC) | Backup | Run | Result | Duration | Notes |
|------------|--------|-----|--------|----------|-------|
| 2026-11-21 | `production-backup-20261121T044216Z` (schema 202611200006, INSERT format) | [44867383491](https://github.com/Rish866/KaamSetu/actions/runs/44867383491) | **Failed**, finding | 55 s | A plain restore into a new Supabase database gave `anon` EXECUTE on every function and gave `service_role` write access to every table. Cause: new projects' default privileges apply before the dump's grants. Fixed in the procedure: default privileges are applied before the schema. INSERT-format data could not be counted exactly, so backups now use `--use-copy`. |
| 2026-11-21 | `production-backup-20261121T044756Z` | [44867815898](https://github.com/Rish866/KaamSetu/actions/runs/44867815898) | Failed | | Empty `COPY` block for managed table `storage.buckets_vectors`: permission denied. Empty blocks are now dropped. |
| 2026-11-21 | `production-backup-20261121T044756Z` | [44868237416](https://github.com/Rish866/KaamSetu/actions/runs/44868237416) | **Passed** | 52 s restore | 17 tables / 52 rows equal to the backup; schema_version 202611200006; production catalog checks passed on the restored copy. |

Not yet rehearsed: switching the live website and workflows to a restored project.
