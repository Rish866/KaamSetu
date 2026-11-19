# Owner actions (only Aarvya Global Ventures LLP can do these)

One step at a time, in this order. Never paste a key or password into chat: enter it only on the website named.
Status of each step is recorded in docs/AUDIT.md.

## Step 1 (blocks everything that touches production)
Add three repository secrets: GitHub → Rish866/KaamSetu → Settings → Secrets and variables → Actions → **New repository secret**:
* `SUPABASE_ACCESS_TOKEN`: create at supabase.com/dashboard/account/tokens (name it "KaamSetu GitHub Actions").
* `SUPABASE_DB_PASSWORD`: the database password of project `zrexqtzhdkkupyxmfqxd` (Supabase → Project Settings → Database; reset it there if unknown).
* `BACKUP_PASSPHRASE`: a long passphrase you invent and also save in your password manager. It encrypts the production backups (the repository is public).

Then say "secrets added". The engineer then runs `status`, `backup` and `dry-run` and reports the results before anything is changed.

## Step 2: deployment window (after step 1's dry-run is reviewed)
Be available for about 30 minutes. The engineer merges PR #3 and applies the migrations; immediately afterwards you deploy the website from `main` to the existing Sites project in your OpenAI workspace (same project, same custom domain, same public audience). Say "deployed" when Sites shows the new version.

## Step 3: test administrator for live verification
Create a separate account (for example qa-admin@getkaamsetu.in) on the website, give it the admin role, and add GitHub secrets `LIVE_ADMIN_EMAIL` and `LIVE_ADMIN_PASSWORD`. To grant the role, sign in with your own admin account → Admin → Access & matching → Grant role (needs the new account's user ID from the Users tab). If no admin account exists yet, the engineer will provide one SQL statement for you to run in the Supabase SQL editor.

## Step 4: background workers
Add GitHub secret `WORKER_SECRET` (any random 40-character value). The engineer then deploys the Edge Functions and sets the same secret in Supabase through the workflow.

## Step 5: email delivery (purchase/account)
Create an account with Resend or Postmark, add the domain `getkaamsetu.in`, add the DNS records it shows in GoDaddy, wait until the provider shows the domain as verified, then add secrets in Supabase → Edge Functions → Secrets: `EMAIL_PROVIDER` (`resend` or `postmark`), `EMAIL_API_KEY`, `EMAIL_FROM` (e.g. `KaamSetu <no-reply@getkaamsetu.in>`). Also set the same provider as custom SMTP in Supabase → Authentication → SMTP. After this, email confirmation can be turned on.

## Step 6: malware scanning (decision with cost)
Choose how resumes are scanned: self-host the open-source ClamAV REST service (small server, monthly cost) or a commercial scanning API. Until then every resume stays quarantined and employers cannot open resumes.

## Step 7: mailboxes and legal
Create `support@getkaamsetu.in` and `privacy@getkaamsetu.in`. Send docs/PRIVACY.md (the "Items that need legal approval" list), `src/content/legal.ts` and docs/store/PRIVACY_DISCLOSURES.md to a qualified Indian lawyer.

## Step 8: Google Play
Create a Play Console developer account for the LLP (fee + identity verification), create app `com.rish866.kaamsetu`, enrol in Play App Signing, generate an upload keystore on your own computer and add the four `ANDROID_*` GitHub secrets (docs/RELEASE.md).

## Step 9: Apple
Enrol the LLP in the Apple Developer Program (fee; needs a D-U-N-S number), create the App Store Connect app, run `npx eas-cli@latest credentials` once on your computer, add GitHub secret `EXPO_TOKEN`.

## Step 10: pilot
Physical Android and iPhone devices for smoke tests, 3–5 employers and 20–50 candidates (docs/PILOT.md).
