# v1.4.0 coordinated website + database release plan

Status: **prepared, not approved, not executed.** Nothing in this file has been done to production unless a run ID says so.
The Android/iPhone store builds, legal review and the backup restore drill are separate tracks (section 8). This
release does not depend on them, and they are not part of this approval.

## 1. Why the order is "website first, then database"

| Order | What users see in between | Verdict |
|-------|---------------------------|---------|
| Database first (old plan) | v1.3.0 site is live on the new schema. Its Apply and Post Job buttons write tables directly, which v1.4.0 refuses (that was a security hole). Broken until the new site is deployed, and nobody can guarantee how long that takes. | Rejected |
| Database first with compatibility shims | Re-opening the direct writes so v1.3.0 keeps working. Reintroduces the holes migrations 0001/0004 close. | Rejected |
| **Website first** | The v1.4.0 site checks `schema_version()`. On the v1.3.0 database it does not exist (production answers `PGRST202`, checked 2026-11-20), so sign-in, sign-up, reset-password and all dashboards show "KaamSetu is being updated". The home, privacy, terms and support pages keep working. When the migration finishes, the same site works with no redeploy. | **Chosen** |

Evidence for the website-first behaviour:
* Browser test `e2e/maintenance.spec.ts` (CI `web` job): with the function missing and with an older schema, every gated route lands on `/maintenance`, public pages do not. A network error on the check does not lock users out.
* One-off local check, 2026-11-20: the v1.4.0 build configured for production, served locally, against the **real** v1.3.0 production API. `/login`, `/login?role=employer`, `/reset-password`, `/candidate`, `/employer`, `/post-job` and `/admin` ended on `/maintenance`. `/`, `/privacy`, `/terms` and `/support` rendered normally, with 0 page errors. This was read-only (one RPC call per page).
* The opposite direction (the new site on the migrated schema) is what the CI `e2e-local-stack` job tests: real UI journeys on a local Supabase stack with migrations 0001–0006.

## 2. How the website is deployed

* `.openai/hosting.json` points the Sites project `appgprj_6afabfa209448191845427c4122d1c00` at `dist/`.
* There is **no evidence that merging to `main` deploys automatically.** GitHub shows no Sites commit statuses, check runs or deployments for any commit.
* The live site's route bundles match a local build of `main`/`v1.3.0` source made without environment variables. A build made with the production variables (as CI does) produces different module numbering, so hash comparison cannot prove which build is live. Conclusion: the site is built and published from the owner's OpenAI workspace. **The owner deploys it by hand.**
* Treat auto-deploy as unknown. If Sites does deploy on merge, step 4 below happens by itself; the plan still works because the new site is safe on the old database.

Deployable packages (CI artifacts, 90-day retention, on every PR run):
* `website-<PR head sha>`: the exact `dist/` that the CI browser tests ran against, with build marker `<meta name="kaamsetu-build" content="<sha>">`, `MANIFEST-<sha>.sha256` (per file) and `KaamSetu-web-<sha>.tar.gz.sha256`. Before upload, the packaging script checks that the bundle points at `zrexqtzhdkkupyxmfqxd` and contains no secret key material.
* `website-rollback-<main sha>`: `main` built the same way. CI checks that the app source on `main` (src, app.json, package files, assets) is identical to the latest release tag `v1.3.0`, so this is the current production site rebuilt.

If Sites builds from source instead of accepting an uploaded `dist/`, the owner deploys from `main` after the merge, as for v1.3.0. The marker then reads `local` (no `EXPO_PUBLIC_BUILD_SHA`), and the deploy is verified by `/maintenance` returning 200 (it is 404 on v1.3.0) plus the checks in step 5.

## 3. Preconditions (checked immediately before starting)

1. PR #3 CI green on the head being merged, including `web` (browser + maintenance tests) and the rollback package job.
2. `Production database` → `dry-run` on that head lists exactly 202611200001–202611200006 as pending.
3. `drift` on that head: 0 structural differences.
4. Owner is at the OpenAI workspace with Sites open and has 30 minutes.

## 4. Steps, owner and duration

| # | Step | Who | Expected time |
|---|------|-----|---------------|
| 1 | Merge PR #3 into `main` (merge commit). | Engineer, after approval | 1 min |
| 2 | CI on `main` green (same jobs as the PR). | automatic | ~12 min (does not affect users) |
| 3 | Run `Production database` → `backup` on `main`; confirm the encrypted artifact exists. | Engineer | ~3 min (backup step took 122 s in run 44748509470) |
| 4 | **Deploy the website** from `main` (or upload `website-<merge sha>` if Sites accepts a directory). | **Owner** | Sites-dependent, typically a few minutes |
| 5 | Verify the deploy: `https://www.getkaamsetu.in/maintenance` returns 200; `/login` shows "KaamSetu is being updated"; home, privacy, terms and support render. **Maintenance window starts here.** | Engineer | 2 min |
| 6 | `Production database` → `apply` on `main`, confirm `APPLY zrexqtzhdkkupyxmfqxd`. The job takes its own backup, verifies it, applies 0001–0006, prints migration history, runs `scripts/production-checks.sql` and `verify-production.mjs --expect-schema 202611200006`. | Engineer | ~6 min (backup ~2 min, migrations under 1 min on near-empty data, checks ~1 min) |
| 7 | Reload the site: sign-in works, no maintenance screen. **Maintenance window ends.** Run `checks` again and `node scripts/verify-production.mjs` for both domains. | Engineer | 3 min |
| 8 | Real-UI live journey (`e2e/live/journey.spec.ts`) with the owner-authorised QA admin (OWNER_ACTIONS step 3). | Engineer | 10 min |
| 9 | Background workers start on their 15-minute schedule (they skip until schema ≥ 0006). First run: privacy clean-up, email outbox (skipped without `RESEND_API_KEY`), resume task (no resumes: uploads are off). | automatic | ≤ 15 min |

**Estimated downtime:** sign-in and dashboards unavailable for about **10–15 minutes** (from the end of step 4 to step 7). The public pages are not interrupted. Today production has 1 profile and no jobs, applications or resumes (preflight), so the window affects at most that one account.

Before step 4 nothing changes for users. If step 4 cannot be completed (owner unavailable, Sites problem), **stop**: the database is untouched and v1.3.0 keeps running. The merge alone does not change production unless Sites auto-deploys, and an auto-deployed v1.4.0 site would simply show maintenance until step 6.

## 5. Rollback

| Failure point | Action | User impact |
|---------------|--------|-------------|
| Step 4–5: new site misbehaves before the migration | Redeploy the `website-rollback-<main sha>` package (or redeploy the previous Sites version, if Sites keeps history). The database is still v1.3.0, so this restores exactly today's state. | Back to v1.3.0 within minutes |
| Step 6: `apply` fails | The Supabase CLI is expected to run each migration file in its own transaction (not verified for this project); check `migration list` in the job log to see which files were recorded. The site stays in maintenance (safe). Fix forward in a new migration through a PR, or, if only some files applied and the state is unclear, restore (last row). **Do not** redeploy v1.3.0 onto a partly migrated database. | Maintenance continues |
| Step 7–8: migrated, but a real defect | Fix forward (new migration and/or new website build). For a severe issue, keep the site in maintenance by redeploying the v1.4.0 package (it shows maintenance whenever the schema check fails) while fixing. Rolling the website back to v1.3.0 after the migration is **not** a rollback: its Apply/Post Job writes are refused. | Partial or maintenance |
| Data damage | Restore the encrypted backup from step 3/6 into a **new** Supabase project (OPERATIONS.md, "Migration recovery"), repoint the site, then redeploy the rollback package. Unrehearsed: no restore drill has been performed yet, so expect hours, not minutes. | Hours |

Migrations are forward-only. No down-migrations exist and none will be written for this release.

## 6. Domains, HTTPS and redirects (checked 2026-11-20, read-only)

* `http://getkaamsetu.in` and `http://www.getkaamsetu.in` → 302 to HTTPS. Both `https://` hosts serve the site (200). There is no apex→www canonical redirect, so the same content is on two hosts.
* Certificates: Google Trust Services WE1, valid 2026-11-18 → 2027-02-16 (auto-renewed by the host/Cloudflare; renewal not verified).
* Served through Cloudflare. Today the live site sends no HSTS and no CSP headers. v1.4.0 ships `dist/_headers` (HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) and a CSP `<meta>` tag. Whether Sites applies `_headers` is unknown; check with `curl -sI https://www.getkaamsetu.in/` after step 4. The `<meta>` CSP applies either way, but HSTS and frame-ancestors only work as headers.
* Static routing: extensionless paths map to `.html` (`/candidate` 200). `/privacy` and `/candidate/job` are 404 today only because v1.3.0 does not have those pages.
* Recommendations (owner, in Cloudflare/Sites; not required for this release): a permanent 301 apex → www; 301 instead of 302 for HTTP → HTTPS; turn on HSTS at Cloudflare if `_headers` is ignored.

## 7. What this release does not switch on

* **Resume uploads stay off** (migration 0006 gate). They are switched on only by an admin, with a reason (audited), after a real ClamAV scan has been seen working in production: dispatch the `Background workers` workflow, upload a test PDF as the QA candidate, and confirm it moves to `clean`. A scan still pending after 24 hours fails visibly (`scan_timeout`) and the candidate is notified, so no file stays quarantined indefinitely.
* **Email** is queued, not delivered, until the owner sets up Resend (OWNER_ACTIONS step 5) and the `email-setup` action configures Supabase Auth SMTP.

## 8. Separate tracks (not in this approval)
Android and iPhone store publication, legal review of the privacy/terms drafts, the backup restore drill, Sentry/monitoring. See OWNER_ACTIONS.md.
