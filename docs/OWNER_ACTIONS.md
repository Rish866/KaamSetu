# Owner actions (things only Aarvya Global Ventures LLP can do)

Do them in this order. Each step is one action. Never paste a key or password into chat; enter it only on the website named.

## A. Go live with v1.4.0 (needed first)
1. **Merge the pull request** on GitHub (green "Merge" button) once you have read the summary.
2. **Supabase plan:** in supabase.com → project `zrexqtzhdkkupyxmfqxd` → Billing, choose Pro and turn on Point-in-Time Recovery (paid; recommended before real users).
3. **GitHub secrets** (GitHub → repository → Settings → Secrets and variables → Actions → New repository secret):
   `SUPABASE_ACCESS_TOKEN` (from supabase.com/dashboard/account/tokens) and `SUPABASE_DB_PASSWORD` (Supabase → Database settings).
   After this, I (or any engineer) can apply the migrations and verify history without ever seeing the values.
4. **Email provider:** create an account with a transactional email service (for example Resend, Amazon SES or Postmark), add the domain `getkaamsetu.in`, and add the DNS records it gives you in **GoDaddy** → DNS. Then in Supabase → Edge Functions → Secrets add `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`. Also set the same provider as custom SMTP in Supabase → Auth → SMTP so confirmation and reset emails come from your domain.
5. **Mailboxes:** create `support@getkaamsetu.in` and `privacy@getkaamsetu.in` (GoDaddy email or Google Workspace) and decide who reads them.
6. **Sites deploy access:** allow deployment of `dist/` to the existing Sites project (`.openai/hosting.json`). Keep the custom domain and public audience unchanged.
7. **Promote at least one more trusted person** to moderator after go-live (Admin console → Access). Do not share your own login.

## B. Legal (before inviting pilot users)
8. Send `docs/PRIVACY.md`, `src/content/legal.ts` and `docs/store/PRIVACY_DISCLOSURES.md` to a qualified Indian lawyer. Every **[LEGAL]** item needs a decision.
9. Fill in: Grievance Officer name, registered postal address, response time, retention periods, incident contacts (docs/OPERATIONS.md section 5).

## C. Decisions with cost (optional but recommended)
10. Resume malware scanning vendor (until then resumes stay quarantined and are not downloadable).
11. Resume parsing vendor (the review flow is ready; nothing is applied without candidate approval).
12. Cloudflare Turnstile CAPTCHA (free) for sign-up abuse.
13. Error monitoring (Sentry, free tier), after legal review of the processor.
14. SMS provider, only if you want phone-only users to reset passwords (not needed for launch).

## D. Android (Google Play)
15. Create a Google Play Console developer account for Aarvya Global Ventures LLP (one-time fee, identity and organisation verification by Google).
16. Create the app `com.rish866.kaamsetu`, accept the agreements, and enrol in Play App Signing.
17. Generate an upload keystore on your own computer (`keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`), keep two offline backups, and add GitHub secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. The next tag then produces a signed AAB.
18. Upload the AAB to the Internal testing track and fill the listing from `docs/store/`.

## E. iPhone (App Store / TestFlight)
19. Enrol Aarvya Global Ventures LLP in the Apple Developer Program (annual fee; needs a D-U-N-S number for organisations).
20. In App Store Connect create the app with bundle ID `com.rish866.kaamsetu`.
21. Create an Expo account (expo.dev), run `npx eas-cli@latest credentials` once on your Mac/PC to let EAS manage Apple certificates, and add GitHub secret `EXPO_TOKEN`. The next tag then sends a build to TestFlight.

## F. Pilot
22. Create the reviewer/test accounts (docs/store/REVIEWER_ACCOUNTS.md).
23. Run the first restore drill (docs/OPERATIONS.md section 4) and the staging security checks (docs/SECURITY.md).
24. Invite 3–5 employers and 20–50 candidates (docs/PILOT.md).
