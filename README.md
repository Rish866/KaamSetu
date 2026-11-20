# KaamSetu

KaamSetu is a privacy-first, two-sided recruitment marketplace for Mumbai, Navi Mumbai, Thane and Pune, operated by
Aarvya Global Ventures LLP. One Expo SDK 58 / React Native codebase serves the website (https://www.getkaamsetu.in),
Android (`com.rish866.kaamsetu`) and iPhone. Data lives in Supabase (Postgres + RLS, Auth, private Storage).

The v1.4.0 code on `feature/product-screens` has no demo mode: every screen reads data from the configured Supabase project through row-level security and audited database functions. Production currently still runs v1.3.0; see docs/AUDIT.md for the exact state.

## What it does
* **Candidates:** search verified, salary-visible jobs; explainable match scores; apply, withdraw, track timeline; respond to interviews and invitations; full profile and private resume; consent controls; data export and deletion.
* **Employers:** verify the company, manage a team, draft and publish jobs through moderation, run a hiring pipeline, schedule interviews, make offers, discover consenting candidates.
* **Administrators:** role-based trust and safety console (admin, moderator, support, privacy) with an immutable audit log.

## Develop
```bash
npm ci
cp .env.example .env            # publishable values only
npm run web                     # dev server
npm run lint && npm run typecheck
npm run test:unit               # pure logic
npm run test:db                 # 80 database tests on in-process Postgres (PGlite): a simulation of Supabase, not Supabase itself
npm run build:web && npm run test:e2e   # browser tests on the LOCAL production build (no backend)
npm run gen:types               # regenerate src/lib/database.types.ts after a migration
```

Rules: never edit an applied migration (add a new timestamped file); never put a secret/service key in `EXPO_PUBLIC_*`;
every new table needs RLS and a negative cross-account test in `tests/db`.

## Documentation
| File | Purpose |
|------|---------|
| docs/AUDIT.md | Current state: what is merged, deployed, blocked |
| docs/TRACEABILITY.md | Every feature: code, database control, test, live status |
| docs/SECURITY.md | Security model, test evidence, pen-test checklist |
| docs/PRIVACY.md | Consent, rights, retention, items for legal review |
| docs/OPERATIONS.md | Deploy, schedules, daily review, backups and restore drill, incidents, secret rotation |
| docs/PILOT.md | Controlled pilot plan and metrics |
| docs/store/ | Store listing, privacy disclosures, reviewer accounts, checklists |
| docs/OWNER_ACTIONS.md | Everything only the owner can do, in order |
