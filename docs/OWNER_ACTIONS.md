# Owner actions (only Aarvya Global Ventures LLP can do these)

One step at a time, in this order. Never paste a key or password into chat: enter it only on the website named.
Status of each step is recorded in docs/AUDIT.md.

## Step 1 (done 2026-11-20: secrets added; status, backup and dry-run passed)
Add three repository secrets: GitHub → Rish866/KaamSetu → Settings → Secrets and variables → Actions → **New repository secret**:
* `SUPABASE_ACCESS_TOKEN`: create at supabase.com/dashboard/account/tokens (name it "KaamSetu GitHub Actions").
* `SUPABASE_DB_PASSWORD`: the database password of project `zrexqtzhdkkupyxmfqxd` (Supabase → Project Settings → Database; reset it there if unknown).
* `BACKUP_PASSPHRASE`: a long passphrase you invent and also save in your password manager. It encrypts the production backups (the repository is public).

Then say "secrets added". The engineer then runs `status`, `backup` and `dry-run` and reports the results before anything is changed.

## Step 2: approve and take part in the coordinated release (docs/RELEASE_PLAN.md)
One approval covers: merging PR #3, deploying the website, and applying migrations 202611200001–0006. Be available for
about 30 minutes at the OpenAI workspace with the Sites project for getkaamsetu.in open.
1. The engineer merges PR #3 and takes a backup. Nothing changes for users yet.
2. **You deploy the website** from `main` to the existing Sites project, the same way you published v1.3.0 (same project,
   same custom domains, same public audience). If Sites lets you upload a folder, you can instead upload the contents of
   the CI artifact `website-<merge sha>` (the engineer gives you the link and SHA-256 checksum). Say "deployed".
3. The engineer confirms the site shows "KaamSetu is being updated" on sign-in, then applies the migrations
   (about 6 minutes) and confirms sign-in works again. Expected sign-in downtime: 10–15 minutes. The home, privacy,
   terms and support pages stay up throughout.
4. If something goes wrong before the migration, you redeploy the previous version (Sites history, or the artifact
   `website-rollback-<sha>`) and nothing else changes.

## Step 3: test administrator for live verification
Create a separate account (for example qa-admin@getkaamsetu.in) on the website, give it the admin role, and add GitHub secrets `LIVE_ADMIN_EMAIL` and `LIVE_ADMIN_PASSWORD`. To grant the role, sign in with your own admin account → Admin → Access & matching → Grant role (needs the new account's user ID from the Users tab). If no admin account exists yet, the engineer will provide one SQL statement for you to run in the Supabase SQL editor.

## Step 4: background workers (nothing to do)
No secret is needed: the "Background workers" workflow uses the existing `SUPABASE_ACCESS_TOKEN`. It starts by itself
after the merge and does nothing until the migrations are applied.

## Step 5: email delivery with Resend Free ($0; 3,000 emails/month, 100/day)
1. Sign up at resend.com with the company mailbox.
2. Domains → Add domain → `getkaamsetu.in` (region of your choice). Resend shows DNS records (SPF/MX on a `send`
   subdomain, a DKIM TXT record, optionally DMARC).
3. GoDaddy → My Products → getkaamsetu.in → DNS → add each record exactly as shown. If the domain's nameservers are at
   Cloudflare (the site is served through Cloudflare), add them in Cloudflare DNS instead, with proxy **off** (grey cloud).
4. Wait until Resend shows the domain as **Verified** (minutes to a few hours).
5. API Keys → Create API key, permission "Sending access", domain `getkaamsetu.in`. Copy it once.
6. GitHub → Rish866/KaamSetu → Settings → Secrets and variables → Actions → New repository secret
   `RESEND_API_KEY` = that key. Do not paste it anywhere else.
7. Say "Resend added". The engineer runs `Production database` → `email-setup` (points Supabase Auth SMTP at
   smtp.resend.com:465 with this key) and sends a test password-reset email to the QA mailbox. The workers then deliver
   queued notification emails. Only after a confirmed delivery should email confirmation be turned on.
The free plan's 100/day limit is enough for the pilot; Resend Pro is the upgrade if daily volume grows.

## Step 6: malware scanning (nothing to buy)
Resumes are scanned by open-source ClamAV inside the "Background workers" GitHub workflow (no server, no cost). Resume
uploads stay **switched off** after the release. After the engineer has shown a production test file being scanned
`clean`, you (or another admin) switch them on in Admin → System with a reason. Decision for you and the lawyer: this sends
resume files to GitHub-hosted runners for a few seconds, so GitHub becomes a data processor for resumes.

## Step 7: mailboxes and legal
Create `support@getkaamsetu.in` and `privacy@getkaamsetu.in`. Send docs/PRIVACY.md (the "Items that need legal approval" list), `src/content/legal.ts` and docs/store/PRIVACY_DISCLOSURES.md to a qualified Indian lawyer.

## Step 8: Google Play
Create a Play Console developer account for the LLP (fee + identity verification), create app `com.rish866.kaamsetu`, enrol in Play App Signing, generate an upload keystore on your own computer and add the four `ANDROID_*` GitHub secrets (docs/RELEASE.md).

## Step 9: Apple
Enrol the LLP in the Apple Developer Program (fee; needs a D-U-N-S number), create the App Store Connect app, run `npx eas-cli@latest credentials` once on your computer, add GitHub secret `EXPO_TOKEN`.

## Step 10: pilot
Physical Android and iPhone devices for smoke tests, 3–5 employers and 20–50 candidates (docs/PILOT.md).
