# KaamSetu operations handbook

Audience: whoever runs KaamSetu day to day. Commands assume the Supabase CLI is installed and you are logged in
(`supabase login`) on a trusted computer. Never paste keys into chat, issues or code.

## 1. Deploying a release (order matters)

1. CI is green on the pull request: lint, types, unit, `test:db` (65 database/RLS/journey tests), web build, browser tests, secret scan.
2. Merge the PR into `main`.
3. Back up first (section 4), then apply migrations:
   `supabase link --project-ref zrexqtzhdkkupyxmfqxd` then `supabase db push`.
   Verify: `supabase migration list` shows every file in `supabase/migrations` as applied remotely.
4. Push auth settings: `supabase config push` (applies `supabase/config.toml`: password policy, rate limits, sessions, email confirmation).
5. Deploy functions: `supabase functions deploy email-worker` and `supabase functions deploy unsubscribe`.
6. Set function secrets once: `supabase secrets set EMAIL_API_URL=... EMAIL_API_KEY=... EMAIL_FROM="KaamSetu <no-reply@getkaamsetu.in>" SITE_URL=https://www.getkaamsetu.in`.
7. Web: `npm run build:web`, then deploy `dist/` to the Sites project in `.openai/hosting.json` (`appgprj_6afabfa209448191845427c4122d1c00`). Keep the existing custom domain and public audience.
8. Tag: `git tag v1.4.0 && git push origin v1.4.0`. The release workflow builds the APK, website archive, iOS Simulator zip, checksums, and (if signing secrets exist) the AAB and TestFlight build.
9. Smoke test production (section 6).

**v1.4.0 note:** migration `202611200001` removes direct table writes used by the v1.3.0 app. Ship the v1.4.0 web build
in the same window as the migration. Installed v1.3.0 Android test APKs will stop being able to apply or post jobs
until updated. That is intentional (it closes security holes) and acceptable during the test phase.

## 2. Scheduled jobs

| Job | Schedule | How |
|-----|----------|-----|
| Expire invitations | hourly | pg_cron (`202611200003`) |
| Retention clean-up | daily 02:30 UTC | pg_cron, periods in `public.retention_policies` |
| Send emails | every minute | Supabase Cron → HTTP POST to `/functions/v1/email-worker` with header `Authorization: Bearer <service role key>` (configure in Dashboard → Integrations → Cron; the key stays inside Supabase) |
| Purge files of deleted accounts | daily | `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/purge-storage.mjs` from a trusted machine or a private CI job |

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
* Before every migration, take a logical backup:
  `supabase db dump --linked -f backups/$(date +%F)-schema.sql` and `supabase db dump --linked --data-only -f backups/$(date +%F)-data.sql`.
  Store these encrypted outside the repo (they contain personal data). `backups/` is git-ignored.
* **Restore drill (monthly; first before the pilot):**
  1. Create a scratch Supabase project (free tier is fine).
  2. `psql "$SCRATCH_DB_URL" -f <schema.sql>` then `-f <data.sql>`.
  3. Run `select count(*) from public.profiles; select count(*) from public.jobs; select count(*) from public.applications;` and compare with production.
  4. Record date, duration, row counts and problems in `docs/drills.md`. Delete the scratch project.
* What I could verify without access: every migration applies cleanly from an empty database in order (CI `test:db`).
  A restore against real dumps has **not** been performed and is listed in OWNER_ACTIONS.

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
| Supabase secret / service-role key | Supabase function env (automatic), owner's password manager, Cron job header | Dashboard → API keys → roll; update Cron header and any machine running `purge-storage.mjs` |
| DB password | password manager, GitHub secret `SUPABASE_DB_PASSWORD` | Dashboard → Database → reset password; update the GitHub secret |
| Email provider key | `supabase secrets` | create a new key at the provider, `supabase secrets set EMAIL_API_KEY=...`, revoke old |
| Android upload keystore | GitHub secrets `ANDROID_*` + offline backup | only if compromised: request upload-key reset in Play Console |
| Expo token | GitHub secret `EXPO_TOKEN` | expo.dev → Access tokens → revoke and recreate |

Rotate immediately if a key may have been exposed, and every 12 months otherwise. Gitleaks runs on every PR.

## 8. Monitoring and logging

* Errors are shown to users as plain messages (`friendlyError`), never raw SQL or stack traces.
* The email worker logs only job IDs and error classes, never addresses. Notification titles never contain names, emails or phones (tested).
* Recommended next step (owner choice, free tier available): Sentry for React Native with `sendDefaultPii: false` and a `beforeSend` that strips `email`, `phone`, `password`. Not installed yet to avoid adding a third-party data processor without legal review.
