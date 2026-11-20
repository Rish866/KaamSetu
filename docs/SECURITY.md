# Security model and evidence

## Principles
* The app holds only the **publishable** key. Every authorisation decision is made in PostgreSQL (RLS, column grants, `security definer` functions with `search_path = ''`).
* All sensitive state changes (company verification, job moderation, application stages, interviews, invitations, consent, resumes, roles, privacy) go through validated, audited functions. Clients cannot write those tables directly.
* `private.audit_events`, consent records, application events, job events and contact disclosures reject UPDATE, DELETE and TRUNCATE by trigger, including for the table owner (a superuser can still disable triggers; this protects against application and operator mistakes, not a compromised superuser).
* Candidate contact details are released only by `get_applicant_contact`, which requires an approved company, a recruiter or owner role, a shortlisted (or later) stage, **and** the candidate's latest `contact_sharing` consent. Every release is logged and visible to the candidate.
* Employers can see candidates only if they applied to the employer's job or currently consent to discovery. Discovery results never include name, email, phone or resume.
* Resumes, profile photos and company evidence live in private buckets. Resume objects are readable only when the resume is registered, not deleted and `scan_status = 'clean'`, by its owner or by recruiters of an approved company the candidate applied to (enforced in the storage SELECT policy, migration 0004). Downloads use 60-second signed URLs (expiry not yet verified against Supabase Storage). Uploads require an active account.

## Test evidence (local; CI re-runs the same suites)
| Area | File | Tests |
|------|------|-------|
| RLS isolation, privilege escalation, storage policies, literal handling of SQL metacharacters, grants | `tests/db/rls.test.mjs` | 16 |
| State machines, contact disclosure, discovery, admin roles | `tests/db/workflow.test.mjs` | 9 |
| Matching components, hard filters, ranking, fairness, governance | `tests/db/matching.test.mjs` | 10 |
| Feed, profile, resume review, export/deletion, reports, team, notifications, admin | `tests/db/product.test.mjs` | 10 |
| Fixes for each independent-review finding incl. v1.3.0 upgrade path | `tests/db/review-fixes.test.mjs` | 15 |
| Database-simulated 19-step journey (SQL + RLS roles, **no UI**) | `tests/db/journey.test.mjs` | 20 |
| Formatting, error redaction, password policy | `tests/unit/format.test.ts` | 9 |
| Resume structural inspection, DOCX/PDF text extraction, skill suggestions | `tests/unit/resume-core.test.ts` | 6 |
| Email templates, subject safety, provider and scanner adapters (fake HTTP) | `tests/unit/email.test.ts` | 7 |
| Local production build: route guards, honesty checks, weak-password rejection, axe on 5 public pages, 3 viewports, console/CSP | `e2e/smoke.spec.ts` | 32 |

All database tests run on PGlite with an emulation of Supabase roles and tables. They prove SQL, RLS and grants. They do **not** exercise
GoTrue (sessions, refresh, rate limits, enumeration behaviour), the Storage HTTP API (signed-URL expiry, MIME enforcement), Edge Functions at runtime, or email delivery.

## Staging checks that need a real Supabase project (not yet run)
- [ ] Signed URL returns 400/403 after 60 seconds.
- [ ] Upload of a `.exe` renamed `.pdf` is accepted by Storage (MIME is client-declared) but rejected by the worker's structural check (`not_a_pdf`; tested on the local stack in CI).
- [ ] Session refresh works after 1 hour; inactivity timeout signs the user out.
- [ ] 31st sign-in attempt within the rate-limit window is throttled.
- [ ] Password `password12` is rejected server-side.
- [ ] Email change requires confirmation from both addresses.

## Known gaps and decisions
* **Malware scanning is externally blocked.** The pipeline, quarantine, structural checks, retries and a ClamAV REST adapter exist; no scanner is deployed. Until one is, every resume stays quarantined: nobody can download it and employers cannot open it.
* **Email delivery is externally blocked** on a provider account and verified domain. Messages queue; admins see the backlog.
* **Email confirmation is off** (unchanged from v1.3.0) until SMTP exists, so email ownership is unverified; contact disclosure labels unverified email/phone, and team invitations cannot be accepted.
* **CAPTCHA:** integration point only (`supabase/config.toml`), needs a Cloudflare Turnstile site.
* **Leaked-password protection:** Supabase paid-plan setting, not enabled.
* **CSP** allows `'unsafe-inline'` scripts (Expo static export inlines a hydration script). `public/_headers` may not be honoured by the Sites host; the `<meta>` CSP is.
* **Open review items (medium/low):** `job_feed`/`search_candidates` compute scores per row (fine at pilot scale, needs pre-filtering later); a job id can be probed through `report_job` existence errors (ids are random UUIDs); identical company identifiers across companies are not flagged; default privileges for objects created by `supabase_admin` are Supabase-managed. Tracked in docs/reviews/.
* `npm audit --omit=dev`: no high/critical; moderate findings in transitive dependencies.

## Independent penetration test checklist (for an external tester)
- [ ] Attempt to read or modify another user's rows through the REST API with a valid JWT (all tables in `public`).
- [ ] Attempt every `public.*` RPC as anon, candidate, employer (other company), viewer, moderator, support, privacy.
- [ ] Attempt to self-grant `private.app_roles` or flip `profiles.account_kind`/`status`.
- [ ] IDOR on application, interview, invitation, resume, privacy-request IDs.
- [ ] Storage: list, read and delete across folders and buckets; path traversal in object names.
- [ ] Signup and login enumeration (messages must not reveal whether an account exists).
- [ ] Brute force and credential stuffing against `/auth/v1/token`.
- [ ] Stored XSS via headline, job description, notes, company description (React escapes output; verify the email worker's HTML escaping).
- [ ] CSP, clickjacking (`frame-ancestors`), HSTS on the production domain.
- [ ] Email worker and unsubscribe functions: auth bypass, token guessing.
- [ ] Review `.github/workflows/workers.yml` and `production-database.yml` secret handling (secret key fetched at run time and masked; never written to artifacts).
