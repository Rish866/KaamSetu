# KaamSetu status and audit log

Single source of truth for what is written, tested, merged, deployed and blocked. Feature-level detail: docs/TRACEABILITY.md.
Status words: Written → Locally tested → CI tested → Merged → Deployed → Production tested → Store published; Externally blocked.

## Current state (2026-11-20 20:45 UTC)
| Item | State | Evidence |
|---|---|---|
| Production website | v1.3.0 (demo strings present) | `scripts/verify-production.mjs` 2026-11-19 21:27 UTC |
| Production database | migrations `202611160001`–`202611190001`; Postgres 17.12 | dry-run [44813627572](https://github.com/Rish866/KaamSetu/actions/runs/44813627572) |
| Repository secrets | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `BACKUP_PASSPHRASE` configured by the owner | runs 44748396972 (status), 44748509470 (backup), 44748902289 (main dry-run) |
| PR #3 | Open, mergeable, all 6 CI jobs green; **not merged** | [CI 44812869536](https://github.com/Rish866/KaamSetu/actions/runs/44812869536) on `b35f33c` (docs commits after it are re-run) |
| PR-branch production dry-run | Would push `202611200001`…`202611200005`; pre-flight blockers 0 | run 44813627572 |
| Drift check | 0 structural drift; known differences handled by `202611200005` | [run 44807025417](https://github.com/Rish866/KaamSetu/actions/runs/44807025417) |
| Production apply | **Not done.** Waiting for the owner's explicit approval | — |
| v1.4.0 release | Not created | — |

## Merge plan (why PR #3 is not merged yet)
* PR #2 was closed as superseded; its commit is inside PR #3 unchanged.
* Whether the OpenAI Sites project redeploys automatically when `main` changes cannot be verified from here. If it does, merging before the database migration would put the live site into the "being updated" screen (the schema guard) until the migration runs. PR #3 is therefore merged **in the deployment window**, immediately before the migration is applied.

## Independent review
`docs/reviews/2026-11-19-210714-pr-2-3.md` (verdict NEEDS_CHANGES, 3 blockers, 7 high). Every blocker and high finding is fixed in `202611200004_review_fixes.sql` plus app changes, each with a test in `tests/db/review-fixes.test.mjs`. Medium/low items that remain open are listed in docs/SECURITY.md "Known gaps".

## Baseline findings fixed by PR #2/#3 (from the original v1.3.0 audit)
Employer self-approval, unmoderated job publishing, suspended-company jobs staying public, membership injection, direct candidate writes to applications/consent/notifications/scan state, implicit API grants, missing application history, pre-filled owner company details, demo data in screens. Fixed in code and **locally tested**; none of these fixes is deployed.
