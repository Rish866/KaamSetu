# KaamSetu status and audit log

Single source of truth for what is written, tested, merged, deployed and blocked. Feature-level detail: docs/TRACEABILITY.md.
Status words: Written → Locally tested → CI tested → Merged → Deployed → Production tested → Store published; Externally blocked.

## Current state (2026-11-19)
| Item | State | Evidence |
|---|---|---|
| Production website | v1.3.0, contains demo data strings | `scripts/verify-production.mjs` run 2026-11-19T21:27:32Z |
| Production database | migrations up to `202611190001` only | `schema_version()`, `job_feed`, `matching_versions` return "not found" (PGRST202/PGRST205) |
| PR #2 (`feature/security-foundation`, 1c6c65b) | Closed as superseded (never merged). Its commit is included unchanged in PR #3 | `git log origin/feature/security-foundation..origin/feature/product-screens` |
| PR #3 (`feature/product-screens`) | Open, not merged. CI green on head af9804e | Actions run 44622328465 |
| PR #4 (ops tooling) | Merged into `main` as a14a65b. Adds no app or database change | — |
| Production database workflow | Dispatched once; stopped at "Missing repository secrets: SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD" | Actions run 44619768915 |
| v1.4.0 release | Not created | — |

## Merge plan (why PR #3 is not merged yet)
* PR #3 contains PR #2's commit unchanged, so merging PR #3 alone brings both. PR #2 will be closed as superseded rather than merged separately, so `main` never holds the PR #2 code without the review fixes in `202611200004`.
* Whether the OpenAI Sites project redeploys automatically when `main` changes cannot be verified from here. If it does, merging before the database migration would put the live site into the "being updated" screen (the schema guard) until the migration runs. PR #3 is therefore merged **in the deployment window**, immediately before the migration is applied.

## Independent review
`docs/reviews/2026-11-19-210714-pr-2-3.md` (verdict NEEDS_CHANGES, 3 blockers, 7 high). Every blocker and high finding is fixed in `202611200004_review_fixes.sql` plus app changes, each with a test in `tests/db/review-fixes.test.mjs`. Medium/low items that remain open are listed in docs/SECURITY.md "Known gaps".

## Baseline findings fixed by PR #2/#3 (from the original v1.3.0 audit)
Employer self-approval, unmoderated job publishing, suspended-company jobs staying public, membership injection, direct candidate writes to applications/consent/notifications/scan state, implicit API grants, missing application history, pre-filled owner company details, demo data in screens. Fixed in code and **locally tested**; none of these fixes is deployed.
