# Privacy and consent implementation (for review by a qualified Indian lawyer)

KaamSetu does **not** claim legal compliance. This document maps what the software does to the topics a lawyer will
review under the Digital Personal Data Protection Act, 2023 and the DPDP Rules. Every item tagged **[LEGAL]** needs
lawyer approval before public launch.

## Roles
* Data Fiduciary: Aarvya Global Ventures LLP. **[LEGAL]** confirm, and whether Significant Data Fiduciary obligations could apply.
* Processors: Supabase (database, auth, storage; confirm hosting region), the email provider (to be chosen), OpenAI Sites (web hosting), Expo/EAS (build service, no user data). **[LEGAL]** data-processing agreements and cross-border transfer review.

## Notice and consent (implemented)
| Purpose | Default | Where | Record |
|---------|---------|-------|--------|
| Account (Privacy Notice + Terms acceptance, 18+) | Required checkbox, not preselected | Sign-up | `consent_records` purpose `account`, notice version |
| Employer discovery | Off | Settings, Profile | `employer_discovery` granted/withdrawn |
| Contact sharing after shortlisting | Off | Settings | `contact_sharing` |
| Resume parsing | Off | Settings | `resume_parsing` |
| Marketing email | Off | Settings | `marketing` |

* Consent records are append-only (trigger blocks updates). Withdrawal is one tap and effective immediately (tested: search exclusion and contact-release refusal).
* Notice version is `NOTICE_VERSION` in `src/content/legal.ts`. When the lawyer approves new text, bump the version. Existing users should be asked to re-accept **[LEGAL: whether re-consent is needed for each change]**.
* No dark patterns: no preselected boxes, equal-weight on/off buttons, optional choices explained in plain language.
* **[LEGAL]** Is `account` consent the right basis for core processing, or should some processing rely on "legitimate uses"? **[LEGAL]** Notice in English only; is Marathi/Hindi translation needed?

## Rights (implemented)
* Access/portability: Settings → Download my data (instant JSON export, logged as a completed privacy request).
* Correction: profile editing, all sections.
* Erasure: Settings → Request account deletion → privacy-role admin confirms identity and processes; profile and files are removed or anonymised; consent and audit evidence is kept. **[LEGAL]** confirm what may be retained and for how long.
* Grievance: privacy@getkaamsetu.in is shown in the app. **[LEGAL/OWNER]** name a Grievance Officer, a postal address and a response time; create the mailbox.
* Nomination right (DPDP s.14). **[LEGAL]** Not implemented; needs a process decision.

## Retention (configurable in `public.retention_policies`, run daily)
| Data | Period | **[LEGAL]** approve |
|------|--------|------|
| Read in-app notifications | 180 days | |
| Email delivery records | 90 days | |
| Expired/declined/cancelled invitations | 365 days | |
| Completed privacy request records | 1095 days | |
| Inactive accounts | not yet automated | decide a period (for example 3 years of inactivity, with notice before erasure) |

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
