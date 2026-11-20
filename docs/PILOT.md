# Controlled pilot plan

Scope: 20–50 candidates and 3–5 verified employers in Mumbai, Navi Mumbai, Thane and Pune, real jobs with visible salaries.
KaamSetu must not be described as publicly launched until the exit criteria below pass.

## Entry criteria (all must be true)
- [ ] v1.4.0 migrations applied and verified in production; website deployed
- [ ] Email delivery working from a verified domain (confirmation, password reset, notifications)
- [ ] Backup taken and one restore drill recorded
- [ ] Privacy Notice and Terms reviewed by a lawyer and published
- [ ] At least two people hold admin/moderator roles; support mailbox monitored
- [ ] Staging security checks in docs/SECURITY.md completed

## Recruiting participants
* Employers: invite directly; verify each company with GSTIN/CIN before publishing. Brief them: salaries must be real, no fees.
* Candidates: invite through employer referrals and local networks; explain discovery and contact sharing are opt-in.

## Daily routine
Follow docs/OPERATIONS.md section 3 and record numbers in a shared sheet.

## Success metrics (measured from the database, admin dashboard and audit log)
| Metric | Target |
|--------|--------|
| Candidates who complete profile to 100% | ≥ 60% |
| Company verification turnaround | ≤ 1 working day |
| Job moderation turnaround | ≤ 1 working day |
| Applications that reach "viewed" within 3 days | ≥ 70% |
| Employer response (any stage change) within 7 days | ≥ 80% |
| Interviews confirmed | tracked |
| Hires | ≥ 1 |
| S1 security/privacy incidents | 0 |
| Fraud/fee reports confirmed | 0 unresolved after 24 h |
| Email delivery failure rate | < 2% |

Useful SQL (run in Supabase SQL editor, read-only):
`select stage, count(*) from applications group by 1;`
`select avg(extract(epoch from (e.created_at - a.applied_at))/3600) as hours_to_view from application_events e join applications a on a.id=e.application_id where e.to_stage='viewed';`

## Support process
Users write to support@getkaamsetu.in. Reply within 1 working day. Account issues: use Admin → Users. Never ask for a password.
Privacy requests go to the privacy role. Fraud reports: pause the job immediately, investigate, suspend the company if confirmed.

## Incident reporting
docs/OPERATIONS.md section 5. Any S1 pauses new pilot sign-ups until resolved.

## Rollback plan
* Web: redeploy the previous `KaamSetu-web-<tag>.tar.gz` from GitHub Releases to Sites.
* Database: migrations are forward-only. Fix with a new migration. For data corruption, restore from the pre-migration dump or PITR into a new project and switch the app's Supabase URL (requires a new web build).
* Mobile: pilot users install the previous APK from GitHub Releases.

## Exit criteria (to call KaamSetu launch-ready)
Four consecutive weeks meeting the targets above, no open S1/S2 incidents, legal sign-off, completed external penetration test, and store approval for any store listing.
