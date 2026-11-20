# Feature traceability and evidence

Updated 2026-11-20. Branch `feature/product-screens` (PR #3), **not merged, not deployed**.
Production (website and Supabase `zrexqtzhdkkupyxmfqxd`) still runs v1.3.0 with migrations up to `202611190001`.

## Evidence sources (all recorded, none assumed)

| ID | What | Where | Result |
|---|---|---|---|
| CI | PR CI on head `b35f33c` (merged with `main` a14a65b as `3e3d363`), 2026-11-20 20:36–20:39 UTC | [run 44812869536](https://github.com/Rish866/KaamSetu/actions/runs/44812869536) | all 6 jobs green |
| PG | Database tests on in-process PGlite (emulated Supabase roles/auth/storage) | CI job "Lint, types, unit, database and RLS tests" | 83/83 pass; unit 22/22 |
| SB | **Same database tests on a real local Supabase Postgres 17.12 image** (`supabase db start`, reset per file) | CI job "Migrations, upgrade rehearsal and DB tests on real Supabase Postgres" | 81 pass, 2 skipped (PGlite-only: re-run detection, PGlite upgrade path), 0 fail |
| RH | **Upgrade rehearsal** on real Supabase Postgres: base = the 4 migrations applied in production, v1.3.0-shaped data written with v1.3.0 privileges, production environment emulated (restricted default privileges, `rls_auto_enable` event trigger owned by postgres, RLS on private tables), then the 5 pending migrations via `supabase migration up`; data assertions, catalog checks, Auth/Storage-role DDL probes | same CI job, `scripts/rehearse-upgrade.sh` | passed |
| UI | **Real UI tests on a local Supabase stack** (GoTrue, PostgREST, Storage, Mailpit) against a local production web build: `e2e/live/journey.spec.ts` (23 steps), `auth.spec.ts` (11), `storage.spec.ts` (6) | CI job "Real UI journeys on a local Supabase stack" | 31/31 pass |
| WEB | Local production build + Playwright: route guards, honesty checks, axe WCAG A/AA on public pages, 3 viewports, console/CSP, hung backend, no `[param]` routes | CI job "Web production build…" | 36 pass, 4 skipped (store-asset generators) |
| DRY | `supabase db push --dry-run` against **production** on the PR ref | [run 44813627572](https://github.com/Rish866/KaamSetu/actions/runs/44813627572) (head `b35f33c`) | would push 202611200001–0005 only; pre-flight blockers: 0 rows |
| DRIFT | Read-only schema diff: production vs. the 4 migrations it records as applied | [run 44807025417](https://github.com/Rish866/KaamSetu/actions/runs/44807025417) | 0 structural drift; 5 known differences (resolved by 0005); 116 privilege lines from Supabase's restricted defaults; 1 Supabase-managed function |
| BKP | Encrypted production backup (owner-run) | [run 44748509470](https://github.com/Rish866/KaamSetu/actions/runs/44748509470) | artifact created |
| LIVE | Read-only probe of the deployed site | `scripts/verify-production.mjs`, last run 2026-11-19 21:27 UTC | site = v1.3.0 (demo strings present); new schema absent |

"Production tested" is **No** for every v1.4.0 feature below: nothing from PR #3 is deployed.

## Defects found and fixed in this round (each with a regression test)

| Defect | Found by | Fix | Regression test |
|---|---|---|---|
| Permission loops in 0001/0002/0004 would revoke PUBLIC EXECUTE on Supabase's `public.rls_auto_enable()` (owned by postgres in production), making every DDL by other roles (Auth/Storage upgrades) fail | DRIFT + RH | loops skip event-trigger functions | PG: `review-fixes` "event-trigger functions executable" (fails without the fix); RH: DDL as `supabase_storage_admin` and `supabase_auth_admin` |
| Production gives `service_role` no table privileges; resume worker read `public.skills` directly | DRIFT | 0005: explicit `select (name, active)` on skills; all other service_role table privileges revoked everywhere | PG/SB: "service_role has least privilege" |
| RLS on private tables and two helper definitions differed between production and migrations | DRIFT | 0005 enables RLS on private tables and re-states helpers | PG/SB same test |
| CSP blocked `fetch(blob:)`, so **resume upload failed on web** | UI | `connect-src` adds `blob:`; limited to the configured project origin | UI journey step 3–4, storage spec |
| Downloads opened after an `await` were blocked as popups | UI | `openWhenReady()` opens the tab synchronously | UI storage "owner gets a working 60-second link" |
| Post-job chip groups overlapped the next label; location chips could not be tapped | UI | layout fix in `post-job.tsx` | UI journey steps 9–10 |
| `[id]` dynamic routes exported as `[id].html`; deep links/reloads would break on a plain static host | UI | `/candidate/job?id=…`, `/employer/job?id=…` | WEB "no [param] routes"; UI journey reload check |
| Employer could not reschedule an interview after the candidate asked | UI | button at interview stage | UI journey steps 16–17 |
| Reloading data after an admin action unmounted the screen (search box and confirmations lost) | UI | `useLoad` keeps content mounted on reload | UI auth "suspended accounts", journey 21–22 |
| Settings sign-out did not leave the protected screen | UI | navigate to /login | UI auth "logout from this device" |
| Direct SQL delete of storage objects is refused by real Supabase Storage | SB | test accepts the stricter real behaviour | SB rls suite |

## Feature table

Columns: Implemented (code exists) · CI tested (which evidence) · Deployed · Production tested.

| Feature | Code location | Database/RLS | CI evidence | Deployed | Production tested | Status / blocker |
|---|---|---|---|---|---|---|
| Email/password sign-up, login, session persistence | `src/app/login.tsx`, `src/state/AuthContext.tsx` | `handle_new_user` (M1/M4) | UI auth 1; PG/SB | No | No (v1.3.0 only) | CI tested on local GoTrue |
| Mobile/password sign-up and login | same | same | UI auth 2 (local Auth needed a dummy SMS provider config) | No | No | **Unverified in production**: production phone sign-up depends on the project's SMS provider setting |
| Duplicate email / phone refused, neutral message | `authMessage` | GoTrue unique keys | UI auth 3 | No | No | CI tested. Note: with email confirmation off, the message for an existing address differs from a successful sign-up (inherent to auto-confirm) |
| Wrong password / unknown account same message | `authMessage` | — | UI auth 4 | No | No | CI tested |
| Route isolation; admin door grants nothing | `_layout.tsx` guards, `continueToPortal` | RLS is the real control | UI auth 5; WEB anonymous redirects (10 routes) | No | No | CI tested |
| Logout (device) / logout all devices (refresh token revoked) | `SettingsView.tsx` | GoTrue | UI auth 6–7 | No | No | CI tested. Access tokens already issued stay valid until expiry (≤1 h, GoTrue behaviour) |
| Password reset by email | `login.tsx`, `reset-password.tsx` | GoTrue | UI auth 8 (email read from local Mailpit, link followed, new password used) | No | No | **Production blocked**: no custom SMTP; Supabase's built-in mailer is test-only |
| Password change requires current password | `SettingsView.tsx` | GoTrue | UI auth 8–9 | No | No | CI tested |
| Suspension / restoration | `admin.tsx` Users | `admin_set_account_status` | UI auth 10; PG/SB workflow | No | No | CI tested |
| Rate limits / failed-login protection | `supabase/config.toml` | GoTrue | not tested (local run raises limits) | config not pushed | No | **Unverified** |
| Candidate profile, sections, completion | `candidate/profile.tsx` | M1/M2 RLS | UI journey 2; PG/SB product | No | No | CI tested |
| Resume upload (private, checksum, quarantine) | `lib/files.ts`, `profile.tsx` | `register_resume`, storage policies (M4) | UI journey 3–4, storage 1–2 | No | No | CI tested |
| Signed URLs: owner-only after clean, 60 s, expiry, no public path | `openWhenReady`, `resumeLink` | storage SELECT policy (M4) | UI storage 3–4 (real Storage API, token exp−iat = 60 s, expired link refused) | No | No | CI tested (clean verdict **simulated** by the test) |
| Employer resume access only after application; revoked on withdrawal | `employer/job.tsx` | `get_applicant_resume`, `employer_can_read_resume` | UI storage 5; PG/SB | No | No | CI tested |
| Infected/failed files never downloadable | `resume_scan_report` | M4 | UI storage 6 (verdict simulated) | No | No | CI tested |
| Malware scanning | `supabase/functions/resume-processor`, `_shared/scanner.ts` | M4 pipeline | adapter unit tests use **fake** HTTP; structural checks unit-tested | No | No | **Externally blocked**: no scanner service. All production uploads will stay quarantined |
| Resume parsing + review | `resume-processor`, `ExtractionReview` | consent-gated | unit (DOCX/PDF text, skills); PG/SB | No | No | Blocked behind scanning |
| Job search, filters, explainable match | `candidate/index.tsx`, `candidate/job.tsx` | `job_feed`, `job_detail`, `match_score` | UI journey 11–12 ("Matches 2 of 2 listed skills"); PG/SB matching 10 | No | No | CI tested |
| Applications, timeline, withdrawal | `candidate/applications.tsx` | M1 RPCs | UI journey 12, 19; UI storage 5 (withdraw) | No | No | CI tested |
| Invitations | `employer/discover.tsx` | `invite_candidate` | PG/SB only | No | No | CI tested at DB level; **no UI test** |
| Interviews: propose, reschedule request, re-propose, confirm | `employer/job.tsx`, `candidate/applications.tsx` | M1 | UI journey 16–17 | No | No | CI tested |
| Offer and status updates | same | `transition_application` | UI journey 18–19 (timeline + notifications) | No | No | CI tested |
| Employer onboarding, verification evidence, admin approval with reason | `employer/index.tsx`, `admin.tsx` | M1/M4 | UI journey 5–8 (incl. reason required, audit event visible) | No | No | CI tested (domain identifier; document upload not exercised in UI test) |
| Job management, moderation, close | `post-job.tsx`, `employer/jobs.tsx`, admin Jobs | M1/M4 holds | UI journey 9–10, 23; PG/SB | No | No | CI tested |
| Applicant pipeline, contact disclosure after consent | `employer/job.tsx` | `get_applicant_contact` | UI journey 13–15 | No | No | CI tested |
| Candidate discovery | `employer/discover.tsx` | `search_candidates` (quota) | PG/SB only | No | No | CI tested at DB level; **no UI test** |
| Admin console (companies, jobs, users, privacy, audit) | `admin.tsx` | `admin_*` RPCs | UI journey 8, 10, 21–23; UI auth 10 | No | No | CI tested; reports, email-failure, roles and matching-weights tabs DB-tested only |
| Notifications (in-app) | `NotificationsView.tsx` | M1/M4 | UI journey 19 | No | No | CI tested |
| Email delivery | `functions/email-worker`, `_shared/email-templates.ts` | outbox leases (M4) | PG/SB outbox tests; unit templates/providers (fake HTTP) | No | No | **Externally blocked**: no provider, no verified domain |
| Data export | `SettingsView.tsx` | `request_data_export` | UI journey 20 (file downloaded, own data only) | No | No | CI tested |
| Account deletion | `SettingsView.tsx`, admin Privacy, `functions/privacy-worker` | `admin_process_deletion` (M4) | UI journey 21–23, auth clean-up; PG/SB | No | No | SQL part CI tested; **privacy-worker (Auth soft delete, file purge) never run** |
| RLS / grants / storage policies | M1–M5 | — | PG 83, SB 81, RH, catalog checks (`scripts/production-checks.sql`) | No | No | CI tested; production catalog checks run after apply |
| Backups | `production-database.yml` | — | BKP run 44748509470; apply job re-backs up and verifies the artifact first | — | — | Restore drill **not performed** |
| Website | `src/app/**`, `.openai/hosting.json` | — | WEB, UI | **No** | No | Deploying to Sites needs the owner (no Sites credential here) |
| Android / iOS | `release-builds.yml`, `eas.json` | — | not built for v1.4.0 | No | No | APK/Simulator after tag; signed store builds owner-blocked |
| Legal | `src/content/legal.ts`, `docs/PRIVACY.md` | — | WEB: pages marked draft | — | — | Drafts; lawyer review required |
