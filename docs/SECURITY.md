# Security model and evidence

## Principles
* The app holds only the **publishable** key. Every authorisation decision is made in PostgreSQL (RLS, column grants, `security definer` functions with `search_path = ''`).
* All sensitive state changes (company verification, job moderation, application stages, interviews, invitations, consent, resumes, roles, privacy) go through validated, audited functions. Clients cannot write those tables directly.
* `private.audit_events`, consent records, application events, job events and contact disclosures are immutable (trigger-enforced, even for the table owner).
* Candidate contact details are released only by `get_applicant_contact`, which requires an approved company, a recruiter or owner role, a shortlisted (or later) stage, **and** the candidate's latest `contact_sharing` consent. Every release is logged and visible to the candidate.
* Employers can see candidates only if they applied to the employer's job or currently consent to discovery. Discovery results never include name, email, phone or resume.
* Resumes, profile photos and company evidence live in private buckets with owner-folder policies. Downloads use 60-second signed URLs. New resumes start with `scan_status = 'pending'` (quarantine) and cannot be downloaded until marked clean.

## Test evidence (run `npm run test:db`, `npm run test:unit`, `npm run test:e2e`)
| Area | File | Tests |
|------|------|-------|
| RLS isolation, privilege escalation, storage policies, injection, grants | `tests/db/rls.test.mjs` | 16 |
| State machines, contact disclosure, discovery, admin roles | `tests/db/workflow.test.mjs` | 9 |
| Matching components, hard filters, ranking, fairness, governance | `tests/db/matching.test.mjs` | 10 |
| Feed, profile, resume review, export/deletion, reports, team, notifications, admin | `tests/db/product.test.mjs` | 10 |
| Mandatory 19-step journey | `tests/db/journey.test.mjs` | 20 |
| Formatting, error redaction, password policy | `tests/unit/format.test.ts` | 9 |
| Route guards, honesty checks, axe accessibility, responsive (3 viewports), console/CSP | `e2e/smoke.spec.ts` | 32 |

The database suite runs on PGlite (PostgreSQL 18) with emulated Supabase roles, `auth.uid()` and storage tables. It
proves the SQL and policies. It does **not** exercise GoTrue (sessions, refresh, rate limits), the Storage HTTP API
(signed-URL expiry, MIME enforcement) or email delivery. Those are in the staging checklist below.

## Staging checks that need a real Supabase project (not yet run)
- [ ] Signed URL returns 400/403 after 60 seconds.
- [ ] Upload of a `.exe` renamed `.pdf` is rejected by bucket MIME rules.
- [ ] Session refresh works after 1 hour; inactivity timeout signs the user out.
- [ ] 31st sign-in attempt within the rate-limit window is throttled.
- [ ] Password `password12` is rejected server-side.
- [ ] Email change requires confirmation from both addresses.

## Known gaps and decisions
* **Malware scanning:** the quarantine workflow exists (`scan_status`), but no scanner is connected. Until one is connected (for example ClamAV in an Edge Function or a commercial API), an admin with the service role must mark files clean, or keep resume download disabled for employers. **Owner decision** on vendor.
* **Resume parsing:** the review-and-accept flow and consent gate are built (`resume_extractions`), but no parser is connected. Nothing is ever applied without the candidate's acceptance.
* **CAPTCHA:** integration point is in `supabase/config.toml` (Turnstile). Requires a Cloudflare account (owner).
* **Leaked-password protection:** Supabase offers it on paid plans (Dashboard → Auth → Password security). Owner decision.
* **CSP** allows `'unsafe-inline'` scripts because Expo static export inlines a hydration script. Revisit when hashes are supported.
* `npm audit`: 0 high/critical in production dependencies; 8 moderate in the Expo toolchain (dev-time).

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
- [ ] Review `scripts/purge-storage.mjs` usage and service-role key handling.
