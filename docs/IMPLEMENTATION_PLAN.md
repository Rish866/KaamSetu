# KaamSetu implementation and launch plan

## Launch scope

KaamSetu is a two-sided recruitment marketplace for candidates and verified employers in Mumbai, Navi Mumbai, Thane and Pune. Version 1.0 supports mixed job categories and uses one Expo application for the website, Android and iPhone experiences.

## MVP roles and capabilities

### Candidate

- Create and control a discoverable profile.
- Add skills, experience, preferred locations, salary and work-mode preferences.
- Review explainable job matches and see why each role was recommended.
- Apply to a job, accept or decline an employer invitation and track application status.
- Keep contact information and resumes private until an application or accepted invitation.
- Withdraw optional consent and request export or deletion of personal data.

### Employer

- Create an organisation profile and submit verification information.
- Publish and manage jobs after verification.
- Review masked candidate matches without seeing private contact details.
- Invite candidates and move applications through a visible hiring pipeline.
- Record structured status changes and rejection reasons.

### Administrator

- Review organisations and approve, reject or request more information.
- Moderate jobs and suspend abusive accounts or listings.
- Review reports, audit important actions and handle privacy requests.
- Monitor marketplace health without exposing candidate resumes in routine dashboards.

## Data architecture

Supabase provides PostgreSQL, authentication and private file storage. The schema is defined in `supabase/migrations/202611160001_initial.sql`, with fictional development records in `supabase/seed.sql`.

Core records cover profiles, candidate preferences, skills, organisations, employer memberships, jobs, applications, invitations, match explanations, consent records, moderation reports and audit events. User-owned rows are protected with PostgreSQL row-level security. Employers can access candidate details only through an authorised application or accepted invitation. Administrative access is role-checked and sensitive server operations use protected service jobs, never a service key embedded in the app.

## Matching logic

The first production matcher is deterministic and explainable. It scores only active jobs and candidates who opted into discovery:

- Skills and required capabilities: 35%
- Location, commute and work mode: 25%
- Salary compatibility: 20%
- Experience fit: 15%
- Job freshness: 5%

Hard filters remove closed jobs, blocked relationships, incompatible legal/work requirements and records outside consent boundaries. Every result stores the component scores and a plain-language explanation. Gender, religion, caste, disability, age and other protected attributes must never influence ranking. Matching weights should be evaluated for adverse outcomes before changes are released.

## Consent and privacy

- Essential processing and optional marketing are separate consent choices.
- Employer discovery defaults to a clear user-controlled setting.
- Candidate search uses masked identity and excludes direct contact details and resume files.
- Private resumes use short-lived signed URLs from a non-public storage bucket.
- Access, correction, export and deletion requests have an auditable workflow.
- Retention periods, the operating legal entity, grievance contact and processors must be completed before accepting real users.
- The included privacy notice is a product draft and requires review by qualified Indian counsel before public launch.

## Delivery phases and acceptance tests

### Phase 1 — Product demonstration (complete)

Acceptance:

- Landing, candidate, employer and admin experiences work at phone and desktop widths.
- Navigation and interactive states work on web, Android and iOS from one codebase.
- All sample identities, jobs and organisations are clearly fictional.
- Lint, TypeScript, Expo health checks and the static website build pass.

### Phase 2 — Live accounts and data

Acceptance:

- Candidate, employer and admin users are routed to the correct onboarding.
- Unverified employers cannot publish jobs or reveal private candidate data.
- A candidate can apply once per job and sees every status change.
- Discovery-off candidates do not appear in employer searches.
- RLS tests prove that one user cannot read or change another user's protected rows.

### Phase 3 — Controlled city launch

Acceptance:

- Resume uploads are scanned, parsed and confirmed by the candidate before use.
- Notifications respect consent and include working preference controls.
- Admin moderation, reporting, privacy requests, backups and restore drills are tested.
- Analytics measure funnel health without sending resumes or direct identifiers.
- Store listings, production privacy terms and support/grievance contacts are approved.

## Lean cost assumptions

The codebase and GitHub automation use free tiers initially. A realistic controlled pilot budget is approximately ₹8,000–₹25,000 per month, depending on traffic and support volume:

- Domain and transactional email: roughly ₹1,000–₹3,000 per month.
- Supabase and hosting: free during development, then roughly ₹2,000–₹8,000 per month.
- SMS or WhatsApp verification/notifications: usage-based, roughly ₹2,000–₹10,000 per month.
- Monitoring, backups and small operational tools: roughly ₹1,000–₹4,000 per month.

Apple Developer membership, Google Play registration, legal review, recruiter operations, marketing and paid AI usage are separate owner/business costs. Prices and taxes should be rechecked at purchase time.

## Deployment and release

Every pull request runs lint, type checking, Expo diagnostics and a web export. Merges go to `main`. A version tag such as `v1.0.0` triggers GitHub Actions to package the website, build an installable Android APK and compile an unsigned iOS Simulator app. Physical iPhone/TestFlight/App Store releases require Apple Developer signing credentials. Production secrets belong in the hosting or build provider's secret manager and must never be committed.

## GitHub workflow

1. Create a short branch such as `feature/live-auth`.
2. Make one focused change with tests and documentation.
3. Run `npm run lint`, `npm run typecheck`, `npm run doctor` and `npm run build:web`.
4. Open a pull request using the included template.
5. Review behaviour, privacy impact, screenshots and automated checks.
6. Merge only after checks pass; create a version tag for a release.

