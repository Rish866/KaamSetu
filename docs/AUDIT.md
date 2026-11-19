# KaamSetu production-readiness audit and status

Audit date: 19 Nov 2026. Baseline: v1.3.0 (`main` at 4951e3f). This file is the single source of truth for what is
finished, what is tested, and what is blocked. Nothing is marked done without a test or a recorded check.

## 1. Findings from the baseline audit

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Critical | `companies` UPDATE was granted on all columns, so an employer owner could set `verification_status = 'approved'` on their own company. | Fixed in `202611200001` (column grants + RPC-only review). Test: `employer cannot self-approve company…` |
| 2 | Critical | `jobs` INSERT/UPDATE allowed any status. `post-job.tsx` inserted `pending_review` directly, and a recruiter could write `published`, bypassing moderation and company verification. | Fixed (column grants, status only via RPC, edits limited to draft/rejected). |
| 3 | Critical | Public job read did not check company verification, so suspended-company jobs stayed public. | Fixed (`private.company_is_approved` in policy). |
| 4 | High | Company owners could INSERT arbitrary users into `company_members`, and the last owner could be removed. | Fixed (writes revoked, RPCs, last-owner trigger). |
| 5 | High | Candidates could write applications, invitation status, consent rows, notification content and resume scan state directly. | Fixed (all moved to validated RPCs, immutable history). |
| 6 | High | Implicit default grants gave `anon`/`authenticated` broad table and function privileges on `public`. | Fixed (revoked, explicit re-grants, default privileges changed). Test enumerates function/table privileges. |
| 7 | High | `application_events` had no writer, so no pipeline history existed. Stages had no transition rules. | Fixed (`transition_application`, matrix, events, notifications, audit). |
| 8 | Medium | Employer onboarding pre-filled the owner's company details and website for every employer. | Fixed in UI. |
| 9 | Medium | Admin screen, employer metrics/pipeline/candidates and candidate fallbacks use `src/data/mock.ts` and `DemoContext`. | **Open** (WP3/WP4). |
| 10 | Medium | Supabase email confirmation is disabled (`enable_confirmations = false`). Email-based team invitations and email change need verified emails. | **Open**, owner setting plus config (WP2). |
| 11 | Info | Production Supabase, Sites deployment and signing credentials are not available in the build sandbox. | Blocked, see section 4. |

## 2. Work packages

| WP | Scope | State |
|----|-------|-------|
| 1 | Security foundation, workflow RPCs, matching engine v1, adversarial tests | Done, tested (PR #2) |
| 2 | Candidate product: feed, filters, sorting, saved jobs, detail, apply/withdraw, timeline, interviews, invitations, full profile, resume, consent, settings | Done, tested at DB and route level |
| 3 | Employer product: onboarding, verification + evidence, company profile, team invites/roles, job manager, pipeline, interviews, offers, contact disclosure, discovery | Done, tested at DB and route level |
| 4 | Admin console: queues, evidence, users, reports, privacy, audit search, failed emails, roles, matching weights | Done, tested at DB level |
| 5 | Notifications: in-app centre, read state, preferences, essential vs optional, outbox, retries, unsubscribe, email worker | Built; email delivery **blocked on provider account** |
| 6 | Privacy: versioned consents, export, deletion, retention jobs, legal drafts | Built; **legal review required** |
| 7 | Hardening: headers/CSP, password policy, rate limits, sessions, enumeration-safe messages, runbooks | Built; config push and staging checks pending |
| 8 | Tests: unit, DB/RLS, journey, browser e2e, axe, responsive | Done (see SECURITY.md) |
| 9 | Release automation, store pack, pilot pack | Done; store submission **blocked on accounts** |

Finding #9 (mock data) and #10 (email confirmation) from the table above are resolved in code (`src/data/mock.ts` and
`DemoContext` deleted; `enable_confirmations = true` in config.toml, applied on `supabase config push`).

## 3. Evidence

Run `npm run test:db` (PGlite, in-process PostgreSQL 18 with Supabase-style roles, `auth.uid()` and storage emulation;
every real migration is applied in order). Result on the commit that introduced this file: see PR description.

Covered: anonymous isolation; candidate-to-candidate isolation; cross-company isolation; admin authorisation; role
spoofing through signup metadata; column-level write protection; storage policies for resumes and company evidence;
SHA-256 duplicate detection; path validation; SQL-injection payloads; RLS enabled on every table; no anon-executable
functions; immutable audit and consent history; company, job, application, interview and invitation state machines;
contact disclosure rules; matching components, hard filters, ranking, fairness, weight governance.

Not covered by this suite (needs a real Supabase project): signed-URL expiry, GoTrue session refresh and rate limits,
Storage API behaviour, email delivery. These are listed as WP7/WP8 items and must be run against a staging project.

## 4. External blockers (cannot be solved in code)

* Applying migrations to production project `zrexqtzhdkkupyxmfqxd` needs a Supabase access token or database password in a
  CI secret (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`). Never paste these in chat.
* Deploying to the OpenAI Sites project needs the Sites deploy credential from the platform.
* Google Play, Apple Developer membership, signing keys, a transactional-email provider account and a verified sending domain
  are owner purchases or account actions.
* Legal review of notices, terms and DPDP workflows by a qualified Indian lawyer.

## 5. Important deployment order

`202611200001_security_foundation.sql` removes the unsafe direct writes that the v1.3.0 app relied on. Release the app
build from this branch **together with** the migration. Do not apply the migration to production first.
