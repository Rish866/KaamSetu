# Product upgrade plan (investor feedback, 2026-11-26)

Approved by the owner on 2026-11-26 with these defaults: hire fees ₹0 and switched off until the owner sets them,
jobs auto-pause after 30 days without re-confirmation, public employer scorecards only after 5 applications or 3 offers.
Production database changes are applied only after CI, a dry run and the owner's go-ahead.

| Part | Scope | Status |
|------|-------|--------|
| 1. Pan-India locations | 36 states/UTs, 737 districts, 19,300 PIN codes; type-ahead; job search by places, whole states, PIN prefix, remote; discovery by place; hierarchical location score; India-wide copy | **Deployed and production tested 2026-11-26**: migration applied (run 45774730159, backup production-backup-20261126T072158Z), website build 9e79b0f live, live journey 24/24 (run 45775467310) |
| 2. Offer and joining milestones | offer issued/accepted/declined/withdrawn, joined day 1, no-show, retained day 15/30, left before day 30; both sides confirm, 7-day auto-confirm, disputes decided by admins with a reason | **Deployed and production tested 2026-11-26**: migration applied (run 45788629867, backup production-backup-20261126T090458Z), live journey 25/25 incl. accept → joined → confirmed (run 45789465170) |
| 3. Employer accountability scorecard | median response time, 7-day response rate, offers honoured, hires who joined, day-30 retention; "new employer" below the thresholds; 25-day reminder and 30-day auto-pause | **Written, tested locally** (PR) |
| 4. Outcome-based hiring ledger | pending_milestone → payable → paid / waived / disputed, audited; candidates never charged; no payment gateway yet | Planned |
| 5. DPDP | "joining verification" consent purpose; export and deletion cover new tables; updated notice and legal pack | Planned |

## Part 1 decisions
* Location score: area or PIN match 100, same city 85, same district 75, "entire state" preference 70, otherwise 0
  (a different city in the same state is not a match unless the candidate chose the whole state). Rank discount unchanged.
* `job_feed` and `search_candidates` are kept unchanged for the previously deployed website; the new site uses
  `job_search` and `discover_candidates`.
* Coordinates and radius search are deferred: the official dataset's coordinates are unreliable.

## Part 2 decisions
* "Make offer" records `offer_issued` automatically. Only the candidate turns an offer into a hire (accept), or declines it.
  Employers can no longer mark a candidate "hired" themselves (enforced by a trigger).
* Joining and retention are reported by one side and confirmed or disputed by the other. Reports nobody answers within
  7 days are confirmed by the background worker (`hiring_milestones_auto_confirm`, every 15 minutes). Admins decide disputes
  in Admin → Hiring disputes; a rejected report can be filed again.
* Rules: no-show is employer-only; joining not before the agreed date and within the last 90 days; day 15/30 only after
  15/30 days from the joining day; offers cannot be withdrawn after joining.

## Part 3 decisions
* Window: last 365 days. Thresholds: response from 5 counted applications; offers, joining and retention from 3 outcomes each.
  Below a threshold the metric reads "Not enough data yet (n of m needed)"; with nothing shown the company is a "New employer".
* An application counts for response time once the employer acts, or once 7 days pass unanswered; applications the candidate
  withdrew before any answer are left out. Joining and retention count only confirmed milestones.
* Scorecards are visible to signed-in users for verified companies, and always to the company itself (dashboard).
* Published jobs must be confirmed every 30 days ("Still hiring"); reminder at 25 days, automatic pause at 30 by the worker,
  recorded as a system event. Publishing or resuming counts as confirmation.
