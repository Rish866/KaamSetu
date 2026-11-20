# KaamSetu operations handbook

Audience: whoever runs KaamSetu day to day. Commands assume the Supabase CLI is installed and you are logged in
(`supabase login`) on a trusted computer. Never paste keys into chat, issues or code.

## 1. Deployment window for v1.4.0 (order matters)

Preconditions: repository secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `BACKUP_PASSPHRASE` exist; PR #3 CI is green.

1. **Status (read-only):** Actions → "Production database" → Run workflow, ref `feature/product-screens`, action `status`. Confirms migration history and runs `scripts/preflight.sql`. Any row under "blocker" must be fixed first.
2. **Dry run:** same, action `dry-run`. Shows exactly which migrations would apply (expected: 202611200001, 0002, 0003, 0004).
3. **Merge PR #3** (closes PR #2 as superseded). Confirm CI on `main` is green.
4. **Apply:** action `apply`, ref `main`, confirm `APPLY zrexqtzhdkkupyxmfqxd`. The job takes an encrypted backup first (artifact `production-backup-<timestamp>`), applies only unapplied migrations, prints history, runs `scripts/production-checks.sql` (RLS on every table, no anon-executable functions, private buckets, worker functions not callable by users) and `scripts/verify-production.mjs`.
5. **Website:** the owner deploys `dist/` from `main` to the existing Sites project (`.openai/hosting.json`), keeping the custom domain and public audience. Between steps 4 and 5 the v1.3.0 site is partly broken (its direct writes are now refused). Do 4 and 5 back to back.
6. **Verify:** `node scripts/verify-production.mjs --expect-schema 202611200004` must pass for both domains. Then run the real-UI journey (`e2e/live/journey.spec.ts`) with the owner-authorised test admin.
7. **Edge Functions and workers:** `supabase functions deploy email-worker unsubscribe resume-processor privacy-worker`; `supabase secrets set WORKER_SECRET=<random 32+ chars>`; add the same value as GitHub secret `WORKER_SECRET` so the "Background workers" workflow runs every 10 minutes.
8. Only after 6 passes: tag `v1.4.0` → release workflow builds APK, website archive, Simulator zip, checksums.

## Migration recovery (forward-only)

Migrations are never edited or rolled back in place. If a migration fails or misbehaves:
* **Failed during `db push`:** the Supabase CLI is expected to run each migration file in its own transaction, so a failing file leaves no partial changes and is not recorded as applied (unverified for this project; confirm with `supabase migration list` and `scripts/preflight.sql` after any failure). Fix it in a **new** migration (the failing one was never applied, so it may be corrected before retrying only if `supabase migration list` confirms it is absent remotely).
* **Applied but wrong behaviour:** write a new migration that corrects it (e.g. re-create a policy or function). Re-run CI and the `apply` action.
* **Data damage:** restore from the encrypted backup artifact of that run: `gpg --decrypt <file>.sql.gpg > file.sql`, then restore into a **new** Supabase project (`psql "$NEW_DB_URL" -f roles.sql -f schema.sql -f data.sql`), verify counts against `scripts/preflight.sql` output from the run log, and repoint the app (`EXPO_PUBLIC_SUPABASE_URL`, rebuild). Paid-plan PITR is the faster alternative.
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
| Email delivery | every 10 min | GitHub "Background workers" → `email-worker` | needs WORKER_SECRET + email provider |
| Resume scan/parse/purge | every 10 min | → `resume-processor` | needs WORKER_SECRET; scanning needs a scanner |
| Deletion clean-up (auth identity, files) | every 10 min | → `privacy-worker` | needs WORKER_SECRET |

## 3. Daily review (pilot)

1. Admin console → Overview: queues for companies, jobs, reports, privacy requests, failed emails.
2. Clear the company and job queues (target: within one working day).
3. Reports: anything about fees or fraud is handled the same day (pause the job, suspend the company if confirmed).
4. Privacy queue: confirm identity by email reply before processing deletion.
5. System tab: failed emails. If many, check the provider dashboard and the `email-worker` logs.
6. Supabase Dashboard → Logs: auth errors, 5xx from the API, unusual sign-up spikes.
7. Record pilot metrics (docs/PILOT.md).

## 4. Backups and restore drill

* Supabase takes daily backups on paid plans; Point-in-Time Recovery is an add-on. **Owner decision**: Pro plan with PITR is recommended before real users.
* Before every migration the `apply` action takes an encrypted logical backup (schema, data, roles) as a 30-day workflow artifact. The repository is public, so backups are GPG-encrypted with `BACKUP_PASSPHRASE`; keep that passphrase in the owner's password manager. Run action `backup` on its own at any time.
* **Restore drill (monthly; first before the pilot):**
  1. Create a scratch Supabase project (free tier is fine).
  2. `psql "$SCRATCH_DB_URL" -f <schema.sql>` then `-f <data.sql>`.
  3. Run `select count(*) from public.profiles; select count(*) from public.jobs; select count(*) from public.applications;` and compare with production.
  4. Record date, duration, row counts and problems in `docs/drills.md`. Delete the scratch project.
* Verified so far: every migration applies in order from an empty database, and the v1.4.0 migrations apply on top of a reconstruction of the v1.3.0 production schema with data (`tests/db/review-fixes.test.mjs`, upgrade-path test). **No real backup has been taken and no restore drill has been performed.**

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
| Supabase secret / service-role key | Supabase function env (automatic), owner's password manager | Dashboard → API keys → roll; Edge Functions pick up the new key automatically |
| WORKER_SECRET | `supabase secrets` and GitHub secret | generate a new random value, set it in both places within minutes |
| DB password | password manager, GitHub secret `SUPABASE_DB_PASSWORD` | Dashboard → Database → reset password; update the GitHub secret |
| Email provider key | `supabase secrets` | create a new key at the provider, `supabase secrets set EMAIL_API_KEY=...`, revoke old |
| Android upload keystore | GitHub secrets `ANDROID_*` + offline backup | only if compromised: request upload-key reset in Play Console |
| Expo token | GitHub secret `EXPO_TOKEN` | expo.dev → Access tokens → revoke and recreate |

Rotate immediately if a key may have been exposed, and every 12 months otherwise. Gitleaks runs on every PR.

## 8. Monitoring and logging

* Errors are shown to users as plain messages (`friendlyError`), never raw SQL or stack traces.
* The email worker logs only job IDs and error classes, never addresses. Notification titles never contain names, emails or phones (tested).
* Recommended next step (owner choice, free tier available): Sentry for React Native with `sendDefaultPii: false` and a `beforeSend` that strips `email`, `phone`, `password`. Not installed yet to avoid adding a third-party data processor without legal review.
