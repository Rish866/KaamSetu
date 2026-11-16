# KaamSetu

KaamSetu is a privacy-first recruitment marketplace for Mumbai, Navi Mumbai, Thane and Pune. This repository contains one Expo/React Native application that runs on the web, Android and iPhone.

## Version 1.0

The complete cross-platform MVP includes:

- Public product landing page
- Candidate dashboard with explainable matches, discovery control and sample applications
- Employer dashboard with hiring pipeline, masked candidate cards and invitations
- Admin dashboard with company-verification decisions
- Responsive desktop and mobile layouts
- Initial PostgreSQL/Supabase schema, private resume storage and RLS policies
- Pull-request checks and template

All displayed people, companies and jobs are fictional. Version 1.0 ships in safe demo mode so it can be reviewed without collecting personal information or contacting real employers. The production-ready Supabase schema, row-level privacy rules and setup instructions are included for connecting the live service.

## Run it

Install dependencies:

```bash
npm install
```

Start the website:

```bash
npm run web
```

Start for Android or iPhone development:

```bash
npm run android
npm run ios
```

An Android emulator requires Android Studio. A local iPhone simulator requires macOS, but Expo cloud builds can produce both store-ready apps later.

## Downloadable releases

GitHub Actions produces three release packages from the same reviewed source:

- Installable Android APK
- iOS Simulator application bundle
- Production website export

The production configuration for a signed iPhone/TestFlight build is also included. Apple requires the owner to authenticate with an active Apple Developer account before a physical-iPhone build can be signed.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run doctor
npm run build:web
```

## Connect the live backend

1. Create a Supabase project in the Mumbai region.
2. Copy `.env.example` to `.env` and enter the public project URL and publishable key.
3. Link the Supabase CLI to the project.
4. Review and apply `supabase/migrations/202611160001_initial.sql`.
5. Apply `supabase/seed.sql`.
6. Configure authentication email templates and redirect URLs.

Do not put a Supabase secret/service key in the app. Those credentials bypass RLS and belong only in protected server jobs.

See `docs/RELEASE.md` for build and signing details, `docs/PRIVACY.md` for the privacy notice draft, and `docs/IMPLEMENTATION_PLAN.md` for the full launch roadmap and acceptance criteria.
