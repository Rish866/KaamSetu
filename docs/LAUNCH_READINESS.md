# Launch readiness (public pilot on www.getkaamsetu.in)

**Verdict (2026-11-21): not launch ready.** The website and database release (v1.4.0) is live and its security checks
pass, but the items marked **Blocker** below must be closed first. Each blocker names who can close it.

## Blockers

| # | Item | Why it blocks | Who | How it is verified |
|---|------|---------------|-----|--------------------|
| B1 | Icons missing on the live site (`/assets/node_modules/**` 404) | Every screen shows blank or broken icons; looks broken to users | Engineer: PR #5 (done, awaiting merge). **Owner**: redeploy the website from `main` | `Production database` → `checks`: "every asset referenced by the website bundle is served" passes |
| B2 | Email delivery | No password-reset, invitation or notification email reaches anyone; team invitations cannot be accepted | **Owner**: Resend account, verified domain, GitHub secret `RESEND_API_KEY` (OWNER_ACTIONS step 5). Then engineer runs `email-setup` and a delivery test | A real reset email arrives at the QA mailbox |
| ~~B3~~ | ~~End-to-end journey on the live site~~ **Closed 2026-11-21** | Passed in production: 24/24 (14 journey steps + 10 sign-in/security tests), QA data cleaned up afterwards | Engineer | [run 44873263273](https://github.com/Rish866/KaamSetu/actions/runs/44873263273) |
| B4 | Legal texts are drafts | Privacy notice, terms and consent wording under the DPDP Act need a lawyer's approval before real personal data is collected at scale | **Owner** + lawyer (step 7) | Lawyer's written sign-off; drafts banner removed |
| B5 | Support and privacy mailboxes | The privacy notice and app point users to `support@` and `privacy@getkaamsetu.in`, but the domain has **no MX records**, so mail to them bounces today | **Owner**: Zoho Mail Forever Free (up to 5 mailboxes, $0) with its MX/SPF/DKIM records at GoDaddy | A test mail to each is received |

## Should be done before inviting users (not hard blockers)

| Item | Who | Notes |
|------|-----|-------|
| Resume uploads | Engineer + an admin | Off by design. After B3: upload a test PDF as the QA candidate with uploads on, confirm the ClamAV worker marks it `clean`, then leave uploads on. Decide with the lawyer whether GitHub runners may process resumes |
| HSTS and canonical redirect | OpenAI Sites (host) | DNS is at GoDaddy (`domaincontrol.com`); `www` points to `custom-domains.chatgpt.site`, so the Cloudflare in front belongs to the host, not to us. The host ignores `_headers`. Only the host can add HSTS/redirects; ask its support. The CSP `<meta>` tag still applies |
| Supabase plan / PITR | **Owner** | Free plan has no daily backups or PITR. The `backup` action and restore drill work, but they are manual |
| Error monitoring | **Owner** decision | Sentry is not installed (a new data processor, needs legal review) |
| Live-site cut-over to a restored project | Engineer | The restore itself is rehearsed (docs/drills.md); repointing the site and workflows is not |

## Done and verified in production

| Item | Evidence |
|------|----------|
| v1.4.0 website deployed on both domains | AUDIT.md release log |
| Database migrated to `202611200006` with a verified backup taken first | apply run 44829703139 |
| Data access rules, grants, private buckets; anonymous users refused by private tables and protected functions | checks run 44866418793 |
| Full live journey + sign-in/security tests on the deployed site (temporary audited QA admin; all QA data removed afterwards) | live journey run 44873263273 |
| Live sign-in form reaches production Auth and handles a wrong password correctly | browser check 2026-11-21 |
| Email and phone sign-up work (pre-migration) | auth-probe 44818660584 |
| Background workers run on schedule with ClamAV | worker run 44859921097 |
| Encrypted backup restores completely into a new Supabase database | restore drill 44868237416 |

## Separate tracks (not part of the website launch)
* Android: Play Console account, upload keystore, signed build, store listing (OWNER_ACTIONS step 8). The `metro.config.js` asset-path change also affects native builds; check icons on a device build before store submission.
* iPhone: Apple Developer Program, App Store Connect, EAS credentials (step 9).
* Pilot recruitment and devices (step 10).
