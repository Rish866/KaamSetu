# Release guide

## Deliverables

- Website: `npm run build:web` creates `dist/`.
- Android: GitHub Actions creates an installable APK.
- iOS: GitHub Actions creates an unsigned iOS Simulator application.
- App Store/TestFlight: run the EAS production iOS profile with an Apple Developer account.

## Store identifiers

- Android package: `com.rish866.kaamsetu`
- iOS bundle identifier: `com.rish866.kaamsetu`
- Version: `1.0.0`

## Signed iPhone release

Apple requires an active Apple Developer Program membership, a distribution certificate and a provisioning profile. Once the owner signs in, run:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile production
```

Never commit Apple credentials, provisioning profiles, keystores or service-account keys.
