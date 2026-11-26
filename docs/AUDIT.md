# KaamSetu status and audit log

Single source of truth for what is written, tested, merged, deployed and blocked. Feature-level detail: docs/TRACEABILITY.md.
Status words: Written → Locally tested → CI tested → Merged → Deployed → Production tested → Store published; Externally blocked.

## Current state (2026-11-21 15:20 UTC)
| Item | State | Evidence |
|---|---|---|
| PR #3 (v1.4.0) | **Merged** by the owner as `88a54c0` (identical tree to approved head `0d3e888`); CI on main green | CI [44826372449](https://github.com/Rish866/KaamSetu/actions/runs/44826372449) |
| Production website | **Hosted on GitHub Pages** since 2026-11-21 (the owner can no longer reach OpenAI Sites). Every push to `main` builds, deploys and verifies the site (`.github/workflows/pages.yml`). Let's Encrypt certificate for www and apex (valid to 2027-02-19, renewed by GitHub), HTTPS enforced, apex → www 301 | Pages run 44892608340; live journey on https://www.getkaamsetu.in [44917858454](https://github.com/Rish866/KaamSetu/actions/runs/44917858454) 24/24 |
| Missing icons | **Fixed and deployed**: 31/31 referenced assets served | `verify-production.mjs` passed 2026-11-21 15:12 UTC |
| Production database | **Migrated** to `202611200006` by the owner's `apply` run, after its own verified encrypted backup | [apply 44829703139](https://github.com/Rish866/KaamSetu/actions/runs/44829703139), backup `production-backup-20261120T223212Z` |
| Production checks after release | Catalog checks passed; 30 public API checks passed | [checks 44866418793](https://github.com/Rish866/KaamSetu/actions/runs/44866418793) |
| Sign-in on the live site | **Production tested** (no-write check only): the live form reached production Auth, which returned 400 for a wrong password, and the UI showed the right message, on both domains | browser check 2026-11-21 |
| Full live journey | **Production tested**: 24/24 passed (journey 14, sign-in/security 10; reset-email and local-only storage tests skipped). A temporary QA admin is created per run (audited) and removed; QA data is cleaned up through product functions even if a run fails | [run 44873263273](https://github.com/Rish866/KaamSetu/actions/runs/44873263273); earlier failed runs 44872114795, 44872900877 (test timing bugs, fixed; their data was cleaned up) |
| Email + phone sign-up | Production tested on the v1.3.0 schema (before the migration) | [auth-probe 44818660584](https://github.com/Rish866/KaamSetu/actions/runs/44818660584) |
| Background workers | Running on schedule in production; ClamAV 1.5.5 loaded; nothing to scan (uploads off); email skipped (no provider) | [run 44859921097](https://github.com/Rish866/KaamSetu/actions/runs/44859921097) |
| Backup restore drill | **Passed** into a new empty Supabase database (first attempt found a privilege issue in the restore procedure, now fixed) | [run 44868237416](https://github.com/Rish866/KaamSetu/actions/runs/44868237416), docs/drills.md |
| Resume uploads | **On** since 2026-11-25 after the production ClamAV go-live test passed 9/9 (switch audited) | run 45597894838 |
| Email delivery | **Production tested** 2026-11-24: Resend on `send.getkaamsetu.in`; Supabase Auth SMTP configured; test mail and password-reset mail received. 29 queued mails to QA test addresses suppressed and 20 to anonymised addresses failed before sending, so nothing bounced | runs 45366612896, 45367289078 |
| Security headers | Sites does not apply `_headers`: no HSTS/CSP headers (CSP `<meta>` only). Owner: enable HSTS in Cloudflare | `curl -I` 2026-11-21 |
| v1.4.0 tag / GitHub release / store builds | Not created | — |

## Release log
* 2026-11-20: owner declined migrate-first; deploy-first plan written (docs/RELEASE_PLAN.md).
* 2026-11-20 22:08–22:35 UTC: owner merged PR #3, deployed the website, ran `backup` and `apply`. Migrations 0001–0006 applied; post-apply checks passed in the same run.
* 2026-11-21: post-release verification found the missing-icon defect (PR #5) and ran the first restore drill.
* 2026-11-21: live journey passed in production (run 44873263273).
* 2026-11-26: offer and joining milestones (migration 202611260002) applied and deployed; live journey 25/25.
* 2026-11-26: Pan-India locations (migration 202611260001) applied and website deployed; live journey 24/24.
* 2026-11-25: workers triggered every 15 min by cron-job.org; resume uploads switched on after a passing production scan test.
* 2026-11-24: inbound mail on Zoho (support@, privacy@ → rishabh@); outbound app mail on Resend; password reset verified end to end.
* 2026-11-21: website moved from OpenAI Sites to GitHub Pages. Owner changed GoDaddy DNS (4 A records 185.199.108-111.153; www CNAME rish866.github.io) and enabled the custom domain + HTTPS. Icons fixed in production.

## Independent review
`docs/reviews/2026-11-19-210714-pr-2-3.md` (verdict NEEDS_CHANGES, 3 blockers, 7 high). Every blocker and high finding is fixed in `202611200004_review_fixes.sql` plus app changes, each with a test in `tests/db/review-fixes.test.mjs`. Medium/low items that remain open are listed in docs/SECURITY.md "Known gaps".

## Baseline findings fixed by PR #2/#3 (from the original v1.3.0 audit)
Employer self-approval, unmoderated job publishing, suspended-company jobs staying public, membership injection, direct candidate writes to applications/consent/notifications/scan state, implicit API grants, missing application history, pre-filled owner company details, demo data in screens. Fixed in code, CI tested, and **deployed** with v1.4.0 on 2026-11-20; anonymous access checks pass in production.
