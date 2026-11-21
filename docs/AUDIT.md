# KaamSetu status and audit log

Single source of truth for what is written, tested, merged, deployed and blocked. Feature-level detail: docs/TRACEABILITY.md.
Status words: Written → Locally tested → CI tested → Merged → Deployed → Production tested → Store published; Externally blocked.

## Current state (2026-11-21 05:00 UTC)
| Item | State | Evidence |
|---|---|---|
| PR #3 (v1.4.0) | **Merged** by the owner as `88a54c0` (identical tree to approved head `0d3e888`); CI on main green | CI [44826372449](https://github.com/Rish866/KaamSetu/actions/runs/44826372449) |
| Production website | **Deployed** by the owner from `main` (build marker `local`: Sites built from source); both domains serve v1.4.0; maintenance mode ended after the migration | `/maintenance` 200; browser checks 2026-11-21 |
| Production website defect | **Icons missing**: every `/assets/node_modules/**` file is 404 on the host. Fix in PR #5, not yet deployed | `verify-production.mjs` asset check fails on production |
| Production database | **Migrated** to `202611200006` by the owner's `apply` run, after its own verified encrypted backup | [apply 44829703139](https://github.com/Rish866/KaamSetu/actions/runs/44829703139), backup `production-backup-20261120T223212Z` |
| Production checks after release | Catalog checks passed; 30 public API checks passed | [checks 44866418793](https://github.com/Rish866/KaamSetu/actions/runs/44866418793) |
| Sign-in on the live site | **Production tested** (no-write check only): the live form reached production Auth, which returned 400 for a wrong password, and the UI showed the right message, on both domains | browser check 2026-11-21 |
| Full live journey | **Not run**: 32/32 skipped, `LIVE_ADMIN_EMAIL`/`LIVE_ADMIN_PASSWORD` not configured (owner step 3) | [run 44866655564](https://github.com/Rish866/KaamSetu/actions/runs/44866655564) |
| Email + phone sign-up | Production tested on the v1.3.0 schema (before the migration) | [auth-probe 44818660584](https://github.com/Rish866/KaamSetu/actions/runs/44818660584) |
| Background workers | Running on schedule in production; ClamAV 1.5.5 loaded; nothing to scan (uploads off); email skipped (no provider) | [run 44859921097](https://github.com/Rish866/KaamSetu/actions/runs/44859921097) |
| Backup restore drill | **Passed** into a new empty Supabase database (first attempt found a privilege issue in the restore procedure, now fixed) | [run 44868237416](https://github.com/Rish866/KaamSetu/actions/runs/44868237416), docs/drills.md |
| Resume uploads | Switched **off** in production (by design until a production scan is verified) | migration 0006 |
| Email delivery | **Externally blocked**: Resend account + domain + `RESEND_API_KEY` (owner step 5) | — |
| Security headers | Sites does not apply `_headers`: no HSTS/CSP headers (CSP `<meta>` only). Owner: enable HSTS in Cloudflare | `curl -I` 2026-11-21 |
| v1.4.0 tag / GitHub release / store builds | Not created | — |

## Release log
* 2026-11-20: owner declined migrate-first; deploy-first plan written (docs/RELEASE_PLAN.md).
* 2026-11-20 22:08–22:35 UTC: owner merged PR #3, deployed the website, ran `backup` and `apply`. Migrations 0001–0006 applied; post-apply checks passed in the same run.
* 2026-11-21: post-release verification found the missing-icon defect (PR #5) and ran the first restore drill.

## Independent review
`docs/reviews/2026-11-19-210714-pr-2-3.md` (verdict NEEDS_CHANGES, 3 blockers, 7 high). Every blocker and high finding is fixed in `202611200004_review_fixes.sql` plus app changes, each with a test in `tests/db/review-fixes.test.mjs`. Medium/low items that remain open are listed in docs/SECURITY.md "Known gaps".

## Baseline findings fixed by PR #2/#3 (from the original v1.3.0 audit)
Employer self-approval, unmoderated job publishing, suspended-company jobs staying public, membership injection, direct candidate writes to applications/consent/notifications/scan state, implicit API grants, missing application history, pre-filled owner company details, demo data in screens. Fixed in code, CI tested, and **deployed** with v1.4.0 on 2026-11-20; anonymous access checks pass in production.
