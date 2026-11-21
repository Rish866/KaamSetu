# KaamSetu operations handbook

Audience: whoever runs KaamSetu day to day. Commands assume the Supabase CLI is installed and you are logged in
(`supabase login`) on a trusted computer. Never paste keys into chat, issues or code.

## Website hosting (since 2026-11-21)
The website is published by GitHub Actions to GitHub Pages (`.github/workflows/pages.yml`) on every push to `main`; the job checks the build, deploys it and verifies the live site serves that exact build with every asset. Custom domain and HTTPS are in Settings → Pages. DNS (GoDaddy): four `A` records for `@` → 185.199.108.153, .109.153, .110.153, .111.153 and `www` CNAME → `rish866.github.io`. **Rollback:** Actions → "Website on GitHub Pages" → pick an earlier successful run → Re-run all jobs (redeploys that commit). OpenAI Sites (`.openai/hosting.json`) is no longer used.

## 1. Deployment window for v1.4.0

The full, approved-only procedure is **docs/RELEASE_PLAN.md** (website first, then database; downtime estimate; rollback).
Short form: merge PR #3 → CI on `main` green → `backup` → owner deploys the website (it shows the maintenance screen on the
old database) → `apply` on `main` with confirm `APPLY zrexqtzhdkkupyxmfqxd` → `checks` → live journey. Never run `apply`
before the new website is confirmed live. Store builds (`v1.4.0` tag) come later and separately.

## Migration recovery (forward-only)

Migrations are never edited or rolled back in place. If a migration fails or misbehaves:
* **Failed during `db push`:** the Supabase CLI is expected to run each migration file in its own transaction, so a failing file leaves no partial changes and is not recorded as applied (unverified for this project; confirm with `supabase migration list` and `scripts/preflight.sql` after any failure). Fix it in a **new** migration (the failing one was never applied, so it may be corrected before retrying only if `supabase migration list` confirms it is absent remotely).
* **Applied but wrong behaviour:** write a new migration that corrects it (e.g. re-create a policy or function). Re-run CI and the `apply` action.
* **Data damage:** restore the encrypted backup artifact into a **new** Supabase project with exactly the steps in `scripts/restore-drill.sh` (rehearsed; see section 4). Two steps are essential and easy to miss:
  1. **Default privileges before the schema.** A new project grants everything on new objects to `anon`, `authenticated` and `service_role`. Without first running the `REVOKE` lines plus the backup's own `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres"` lines, the restored database lets anonymous users execute every admin and worker function (found by the first drill).
  2. **Drop empty `COPY` blocks** from the data file; some are for Supabase-managed tables that `postgres` may not write to.
  Then run `psql --single-transaction -f roles.sql -f default-privileges.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql`, run `scripts/production-checks.sql` against the new project (must pass), repoint the website (`EXPO_PUBLIC_SUPABASE_URL` / publishable key, rebuild, redeploy) and the workflows (`PROJECT_REF`). Auth sessions do not survive, so users sign in again. Paid-plan PITR is the faster alternative.
* **App/DB mismatch:** the v1.4.0 app shows "KaamSetu is being updated" when `schema_version()` is missing or older than it needs, instead of failing screens.

## Deleting users
Never delete users from the Supabase dashboard (Authentication → Users → Delete). The delete cascades into immutable consent and
application history and is refused by design (test: `review-fixes` "hard-deleting an auth user…"). Use the in-app deletion
request → Admin → Privacy → Process deletion; the privacy worker then soft-deletes the Auth identity (frees email/phone) and purges files.

## Production environment facts (read-only checks, Actions run 44807025417)
* Postgres 17.12. Extensions: pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp (pg_cron is created by migration 0003).
* Supabase restricted default privileges: API roles get no table privileges unless granted; `service_role` has none on public tables.
* Supabase-managed event trigger `ensure_rls` → `public.rls_auto_enable()` (owned by postgres) enables RLS on every new public table. Migrations must never revoke its EXECUTE.

## 2. Scheduled jobs

| Job | Schedule | How | Status |
|-----|----------|-----|--------|
| Expire invitations | hourly | pg_cron (migration 0003) if the extension is available | unverified in production |
| Retention clean-up | daily 02:30 UTC | pg_cron, periods in `public.retention_policies` | unverified in production |
| Resume scan / parse / purge | every 15 min | GitHub "Background workers" → `scripts/workers/run.mjs --task resumes`: ClamAV (`clamav/clamav:stable` Docker image, bundled signatures) + structural checks; consent-gated parsing; purge of deleted files; scans pending > 24 h fail as `scan_timeout` | CI tested on a local stack (EICAR detected, also inside a DOCX); not run in production |
| Deletion clean-up (auth identity, files) | every 15 min | same workflow, `--task privacy`: Auth soft delete (frees email/phone) + Storage API purge | CI tested on a local stack; not run in production |
| Email delivery | every 15 min | same workflow, `--task email`: outbox → Resend | skipped until GitHub secret `RESEND_API_KEY` exists |

The workflow needs no extra secret: it fetches the project's secret API key at run time from the Management API with the
existing `SUPABASE_ACCESS_TOKEN` (masked in logs, never stored) and does nothing until `schema_version()` ≥ 202611200006.
Scheduled workflows run only from `main`, so workers start after the merge. Run once by hand: Actions → "Background
workers" → Run workflow (task `all`). Note: resumes are sent to GitHub-hosted runners for scanning, which makes GitHub a
processor of resume files **[LEGAL REVIEW]**. Resume uploads stay switched off (Admin → System) until a production scan is verified.

## 3. Daily review (pilot)

1. Admin console → Overview: queues for companies, jobs, reports, privacy requests, failed emails.
2. Clear the company and job queues (target: within one working day).
3. Reports: anything about fees or fraud is handled the same day (pause the job, suspend the company if confirmed).
4. Privacy queue: confirm identity by email reply before processing deletion.
5. System tab: failed emails and the resume-upload switch. If many emails fail, check the Resend dashboard and the "Background workers" run log.
6. Supabase Dashboard → Logs: auth errors, 5xx from the API, unusual sign-up spikes.
7. Record pilot metrics (docs/PILOT.md).

## 4. Backups and restore drill

* Supabase takes daily backups on paid plans; Point-in-Time Recovery is an add-on. **Owner decision**: Pro plan with PITR is recommended before real users.
* Before every migration the `apply` action takes an encrypted logical backup (schema, data, roles) as a 30-day workflow artifact. The repository is public, so backups are GPG-encrypted with `BACKUP_PASSPHRASE`; keep that passphrase in the owner's password manager. Run action `backup` on its own at any time.
* **Restore drill (monthly, and after every schema change):** Actions → "Production database" → action `backup`, then action `restore-drill`. The drill decrypts the newest backup artifact, restores it into a new empty Supabase database on the GitHub runner, and passes only if every table's row count equals the backup, `schema_version()` matches and the production catalog checks pass on the restored copy. It prints table names and counts only. Record the run in `docs/drills.md`.
* **Drills performed:** see `docs/drills.md`. The first passing drill was 2026-11-21 (run 44868237416). This proves the backup is complete and restorable into a fresh Supabase database. It does **not** prove a cut-over of the live website and workflows to a new project; that remains unrehearsed.

## 5. Incident response

Severity: **S1** data exposure or account takeover; **S2** core flow down (sign-in, apply, publish); **S3** degraded.

1. **Contain (S1, within 1 hour):** suspend affected accounts or companies in the admin console; if a key leaked, rotate it (section 7); if a policy is wrong, ship a fix migration (do not edit applied migrations). For a severe leak you may temporarily disable sign-ups (Dashboard → Auth → Providers).
2. **Assess:** use Admin → Audit (actions, actors, time range) and Supabase logs. Write down what data, which users, since when.
3. **Notify:** the owner decides with a lawyer whether to notify affected users and the Data Protection Board of India under the DPDP Act and Rules. **[LEGAL REVIEW: timelines and content]** CERT-In requires certain cyber incidents to be reported within 6 hours. **[LEGAL REVIEW]**
4. **Recover:** fix forward, run CI, deploy, verify.
5. **Review within 5 days:** timeline, root cause, test added to `tests/db` so it cannot recur.

Contacts to fill in: incident lead ________, backup lead ________, lawyer ________.

## 6. Production smoke test (after each deploy)

Use the pilot test accounts (docs/store/REVIEWER_ACCOUNTS.md), never real users:
open https://www.getkaamsetu.in → sign in as test candidate → jobs list loads with salaries → open a job → match explanation shows →
sign in as test employer → jobs and applicants load → admin console overview loads with numbers. Check the browser console has no errors.

## 7. Secret rotation

| Secret | Where it lives | Rotate |
|--------|----------------|--------|
| Supabase publishable key | GitHub variable `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, app builds | Dashboard → API keys → create new publishable key, update the GitHub variable, rebuild web and apps, then revoke the old key after users update |
| Supabase secret key | Supabase (fetched at run time by the workers and production workflows; not stored in GitHub) | Dashboard → API keys → create a new secret key, delete the old one; workflows pick up the new key on their next run |
| DB password | password manager, GitHub secret `SUPABASE_DB_PASSWORD` | Dashboard → Database → reset password; update the GitHub secret |
| Resend API key | GitHub secret `RESEND_API_KEY` (also used as the Supabase Auth SMTP password) | create a new key in Resend, update the GitHub secret, run `Production database` → `email-setup`, delete the old key |
| Android upload keystore | GitHub secrets `ANDROID_*` + offline backup | only if compromised: request upload-key reset in Play Console |
| Expo token | GitHub secret `EXPO_TOKEN` | expo.dev → Access tokens → revoke and recreate |

Rotate immediately if a key may have been exposed, and every 12 months otherwise. Gitleaks runs on every PR.

## 8. Monitoring and logging

* Errors are shown to users as plain messages (`friendlyError`), never raw SQL or stack traces.
* The workers log only job IDs and error classes, never addresses. Notification titles never contain names, emails or phones (tested).
* Recommended next step (owner choice, free tier available): Sentry for React Native with `sendDefaultPii: false` and a `beforeSend` that strips `email`, `phone`, `password`. Not installed yet to avoid adding a third-party data processor without legal review.
