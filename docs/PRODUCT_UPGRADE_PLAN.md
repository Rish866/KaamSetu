# Product upgrade plan (investor feedback, 2026-11-26)

Approved by the owner on 2026-11-26 with these defaults: hire fees ₹0 and switched off until the owner sets them,
jobs auto-pause after 30 days without re-confirmation, public employer scorecards only after 5 applications or 3 offers.
Production database changes are applied only after CI, a dry run and the owner's go-ahead.

| Part | Scope | Status |
|------|-------|--------|
| 1. Pan-India locations | 36 states/UTs, 737 districts, 19,300 PIN codes; type-ahead; job search by places, whole states, PIN prefix, remote; discovery by place; hierarchical location score; India-wide copy | **Deployed and production tested 2026-11-26**: migration applied (run 45774730159, backup production-backup-20261126T072158Z), website build 9e79b0f live, live journey 24/24 (run 45775467310) |
| 2. Offer and joining milestones | offer issued/accepted/withdrawn, joined day 1, retained day 15/30, no-show; both sides confirm; disputes to admin with a reason | Next |
| 3. Employer accountability scorecard | median response time, 7-day response rate, offer-honoured and joining rates, "new employer" below the thresholds, 30-day auto-pause | Planned |
| 4. Outcome-based hiring ledger | pending_milestone → payable → paid / waived / disputed, audited; candidates never charged; no payment gateway yet | Planned |
| 5. DPDP | "joining verification" consent purpose; export and deletion cover new tables; updated notice and legal pack | Planned |

## Part 1 decisions
* Location score: area or PIN match 100, same city 85, same district 75, "entire state" preference 70, otherwise 0
  (a different city in the same state is not a match unless the candidate chose the whole state). Rank discount unchanged.
* `job_feed` and `search_candidates` are kept unchanged for the previously deployed website; the new site uses
  `job_search` and `discover_candidates`.
* Coordinates and radius search are deferred: the official dataset's coordinates are unreliable.
