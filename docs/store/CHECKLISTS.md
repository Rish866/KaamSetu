# Release checklists

## Internal testing (Android, Play internal track)
- [ ] CI green on `main`, tag pushed, release workflow produced APK and SHA256SUMS
- [ ] Install APK on at least one Android 10 and one Android 14 phone
- [ ] Candidate: sign up (email), complete profile, upload PDF resume, search, apply, see timeline
- [ ] Employer: sign up, create company, submit GSTIN/CIN, (admin approves), post job, (admin approves), shortlist, propose interview
- [ ] Candidate confirms interview on phone; employer sees confirmation
- [ ] Back button, keyboard, rotation-locked portrait, TalkBack reads buttons and fields
- [ ] Airplane mode: screens show the offline message and a working "Try again"
- [ ] Settings: download data, request deletion, sign out of all devices

## TestFlight (iOS)
- [ ] Apple Developer Program active, App Store Connect app record for `com.rish866.kaamsetu`
- [ ] `EXPO_TOKEN` secret set; EAS has Apple credentials (run `npx eas-cli@latest credentials` once, interactively, by the owner)
- [ ] Release workflow `ios-testflight` job succeeded; build visible in TestFlight
- [ ] Export compliance answered (no non-exempt encryption)
- [ ] Internal testers added; same functional checks as Android, plus VoiceOver

## Store submission
- [ ] Final legal texts published at /privacy and /terms (version bumped)
- [ ] Support and privacy mailboxes working
- [ ] Data safety (Play) and App Privacy (Apple) filled from PRIVACY_DISCLOSURES.md
- [ ] Content rating questionnaire completed
- [ ] Reviewer accounts working (REVIEWER_ACCOUNTS.md)
- [ ] Screenshots replaced with signed-in screens from test accounts
- [ ] Account deletion URL provided to Google (https://www.getkaamsetu.in/candidate/settings, requires sign-in; also support email)
- [ ] Do not announce availability until each store shows "Approved"/"Ready for Sale"
