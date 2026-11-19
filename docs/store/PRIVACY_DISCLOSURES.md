# Google Play Data safety and Apple App Privacy (drafts, verify before submitting)

Data is encrypted in transit (HTTPS). Users can request deletion in-app (Settings → Request account deletion) and on the
web (same screen at https://www.getkaamsetu.in). No data is sold. No advertising or tracking SDKs. No third-party analytics yet.

| Data type | Collected | Shared with third parties | Purpose | Optional |
|-----------|-----------|---------------------------|---------|----------|
| Name | Yes | With employers the user applies to | App functionality | No |
| Email address | Yes | With an employer only after shortlisting and contact-sharing consent | Account, communications | Either email or phone required |
| Phone number | Yes | Same as email | Account | Either email or phone required |
| Employment history, education, skills | Yes | With employers the user applies to; masked with discovery-enabled employers | App functionality | Yes |
| Salary expectation | Yes | Masked with employers (expected only; current salary never shared) | App functionality | Yes |
| Approximate location (city/locality chosen by user) | Yes | As above | App functionality | Yes |
| Files (resume, profile photo) | Yes | Resume with employers the user applies to | App functionality | Yes |
| App interactions (applications, saved jobs) | Yes | No | App functionality | No |
| Crash logs / diagnostics | No (not yet) | | | |
| Precise location, contacts, photos library access, health, financial info | No | | | |

**Google Play "shared" note:** transfer to an employer at the user's direction may count as user-initiated sharing. **[LEGAL/OWNER]** confirm wording.

**Apple App Privacy labels:** Contact Info (name, email, phone) linked to the user, App Functionality; User Content
(resume, photo) linked, App Functionality; Other Data (employment and education) linked, App Functionality. Tracking: **No**.

## Content rating (IARC questionnaire answers)
Violence: none. Sexual content: none. Language: none. Controlled substances: none. Gambling: none.
User-generated content: **yes** (job descriptions, candidate notes); moderation: all jobs reviewed before publication, report button on every job.
User-to-user communication: limited (employer messages on invitations and interviews); no open chat.
Shares user location: no (user-chosen city only). Expected rating: Everyone / 4+ (Apple may assign 4+; select "Unrestricted web access: No").

## Export compliance (Apple)
Uses only standard HTTPS encryption → `ITSAppUsesNonExemptEncryption = false` is set in app.json.
