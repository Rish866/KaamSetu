# Privacy and consent implementation (DRAFT for review by a qualified Indian lawyer)

**Status: draft. Not reviewed or approved by a lawyer. KaamSetu is not represented as DPDP compliant.**

KaamSetu does **not** claim legal compliance. This document maps what the software does to the topics a lawyer will
review under the Digital Personal Data Protection Act, 2023 and the DPDP Rules. Every item tagged **[LEGAL]** needs
lawyer approval before public launch.

## Roles
* Data Fiduciary: Aarvya Global Ventures LLP. **[LEGAL]** confirm, and whether Significant Data Fiduciary obligations could apply.
* Processors (as of 2026-11-25): Supabase (database, sign-in, file storage; **[OWNER]** confirm hosting region in Supabase → Project Settings → General), GitHub (website hosting on GitHub Pages; background jobs including the resume virus scan, which processes each uploaded resume for a few seconds on GitHub-hosted servers; encrypted database backups kept 30 days), Resend (outgoing app email from send.getkaamsetu.in), Zoho Mail (support@ and privacy@ mailboxes), cron-job.org (only starts the background jobs; receives no personal data), Expo/EAS (app builds, no user data). **[LEGAL]** data-processing agreements and cross-border transfer review.

## Notice and consent (implemented)
| Purpose | Default | Where | Record |
|---------|---------|-------|--------|
| Sharing a security-checked resume with a company you apply to | Happens when you apply | Apply dialog text | `contact_disclosures` row each time an employer opens it |
| Account (Privacy Notice + Terms acceptance, 18+) | Required checkbox, not preselected | Sign-up | `consent_records` purpose `account`, notice version |
| Employer discovery | Off | Settings, Profile | `employer_discovery` granted/withdrawn |
| Contact sharing after shortlisting | Off | Settings | `contact_sharing` |
| Resume parsing | Off | Settings | `resume_parsing` |
| Marketing email | Off | Settings | `marketing` |
| Joining confirmations (joined, day 15, day 30) | Asked when accepting an offer; required to accept | Accept-offer dialog, Settings | `joining_verification` |

* Consent records are append-only (trigger blocks updates). Withdrawal is one tap and effective immediately (tested: search exclusion and contact-release refusal).
* Notice version is `NOTICE_VERSION` in `src/content/legal.ts`. When the lawyer approves new text, bump the version. Existing users should be asked to re-accept **[LEGAL: whether re-consent is needed for each change]**.
* No dark patterns: no preselected boxes, equal-weight on/off buttons, optional choices explained in plain language.
* **[LEGAL]** Is `account` consent the right basis for core processing, or should some processing rely on "legitimate uses"? **[LEGAL]** Notice in English only; is Marathi/Hindi translation needed?

## Rights (implemented)
* Access/portability: Settings → Download my data (instant JSON export, logged as a completed privacy request).
* Correction: profile editing, all sections.
* Erasure: Settings → Request account deletion → privacy-role admin confirms identity and processes; profile and files are removed or anonymised; consent and audit evidence is kept. **[LEGAL]** confirm what may be retained and for how long.
* Grievance: privacy@getkaamsetu.in is shown in the app. **[LEGAL/OWNER]** name a Grievance Officer, a postal address and a response time. (Mailbox exists since 2026-11-24.)
* Nomination right (DPDP s.14). **[LEGAL]** Not implemented; needs a process decision.

## Retention (configurable in `public.retention_policies`, run daily)
| Data | Period | **[LEGAL]** approve |
|------|--------|------|
| Read in-app notifications | 180 days | |
| Email delivery records | 90 days | |
| Expired/declined/cancelled invitations | 365 days | |
| Completed privacy request records | 1095 days | |
| Hiring milestones (offer, joining, day 15/30) | kept; open reports closed and personal notes removed on deletion | |
| Hiring fee ledger (company billing record) | kept | |
| Inactive accounts | not yet automated | decide a period (for example 3 years of inactivity, with notice before erasure) |

## Hiring outcomes, employer reliability and fees (added 2026-11-26)
* Offer, joining, no-show, day-15/day-30 and leaving records are confirmed by both sides; unanswered reports confirm after 7 days; admins decide disputes with a reason.
* Accepting an offer records the `joining_verification` consent. While it is withdrawn no new record about the candidate can be created or confirmed and nothing auto-confirms; admins can still decide earlier records.
* Confirmed outcomes feed public employer reliability figures (no candidate names) and the employer hiring-fee ledger. Candidates are never a party to fees.
* Export (`request_data_export`, version 2) includes hiring records and place names. Deletion closes open reports and removes notes the person wrote; confirmed outcomes stay without the person's name.
* **[LEGAL]** legal basis (consent vs. legitimate use) for joining confirmations; publishing employer statistics; keeping anonymised outcomes after deletion; fee and invoicing terms.

## Children
Sign-up requires confirming 18+. No age is stored or used. **[LEGAL]** confirm self-declaration is adequate for a job marketplace.

## Matching fairness
The engine reads only skills, location, work mode, employment type, salary, experience and job age. It never reads name,
photo, gender, religion, caste, age, marital status or disability, and nothing infers them (enforced by a test that scans
the function source). **[LEGAL]** review of any obligation to explain automated scoring.

## Breach notification
See docs/OPERATIONS.md section 5. **[LEGAL]** confirm DPDP Board and CERT-In reporting duties and timelines.

## Documents needing final legal text
`src/content/legal.ts` (Privacy Notice, Terms, Support), employer terms (fees prohibited, verification, acceptable use), cookie/storage statement for web (only essential local storage is used for the session).


## Items that need legal approval before public launch (consolidated)
1. **Grievance contact:** name of the Grievance Officer / Data Protection contact, postal address, response time (privacy@getkaamsetu.in works since 2026-11-24).
2. **Retention periods:** values in `public.retention_policies` (180/90/365/1095 days) and a policy for inactive accounts (none automated).
3. **Processor list:** Supabase (and hosting region), GitHub (web hosting, background jobs, resume virus scan on GitHub servers, encrypted backups), Resend (app email), Zoho Mail (mailboxes), cron-job.org (job trigger only), Expo/EAS (builds). The in-app Privacy Notice still says email and scanning providers are "when connected"; approve updated wording.
4. **Candidate consent language:** account notice, discovery, contact sharing, resume parsing, marketing; and whether "applying shares your resume with that employer" is an adequate consent mechanism.
5. **Employer terms:** verification duties, no fees from candidates, acceptable use, data handling of disclosed contacts and resumes.
6. **Matching disclosure:** wording that scores are rule-based (not AI), the five factors and weights, and that no protected attributes are used.
7. **Account deletion procedure:** what is erased vs. kept (consent records, audit events, anonymised application history), timelines, and identity verification before processing.
8. **Breach notification** duties and timelines (DPDP Board, CERT-In).
9. **Children:** adequacy of the 18+ self-declaration.
10. **Language:** whether notices are needed in Marathi/Hindi.
11. **Resume virus scanning on GitHub servers:** every uploaded resume is copied for a few seconds to a GitHub-hosted server (USA/global), scanned with open-source ClamAV, then deleted there. Is this acceptable, and what must the notice say?
12. **Joining confirmations and employer reliability:** consent wording in the accept-offer dialog, public employer statistics, retention of anonymised outcomes after account deletion.
13. **Hiring fees:** employer fee terms, invoicing/GST, dispute process (fees are switched off until approved).
14. **Pan-India scope:** notices now say "across India"; confirm nothing state-specific is needed.
