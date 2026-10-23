# Jaraa for Android

A signed Android app (`com.jaraaglobal.jtas`) opens the existing Jaraa workspace through a verified Trusted Web Activity. Chrome supplies the web engine. Android Browser Helper delegates notifications to **Jaraa**, with Jaraa's launcher/small icon and Android notification permission, instead of attributing them to Chrome. This is an internal APK distribution; nothing is published to Google Play.

The application requires Android 7 or later and an updated browser that supports Trusted Web Activities and notification delegation (Chrome is recommended). The web app, permissions, account and department workflow remain the same. Tamil/Hindi selection works inside the app.

## Install and test

1. On Android, download `https://13-127-170-245.sslip.io/downloads/jaraa-android.apk` and approve installation when Android asks. Open the installed **Jaraa** app.
2. Sign in if needed, then open **Your account → Push notifications → Enable notifications** and allow the Android prompt.
3. Press **Send test notification**. Verify Jaraa's name/icon, sound/vibration, notification-panel display and the tap back into the account screen. Test a real workflow alert with the app closed as well.
4. **Settings → Apps → Jaraa → Notifications → Work updates** controls banners, sound, vibration and badges. The channel initially requests high importance; the app preserves user changes. Do Not Disturb, battery/network restrictions and phone settings can affect display/delivery.

An existing browser/PWA icon does not automatically become this APK. Open the newly installed Android app for testing. Shared Chrome sessions/subscriptions can be reused; enabling remains an explicit action for the signed-in user. Keep the current PWA until the new app is tested. There is no need to reset accounts or production data.

## Build

The project started from Google Bubblewrap 1.27.0 and pins Android Browser Helper 2.7.4. Custom `DelegationService.java` provides the work-update channel, and channel labels support English/Tamil/Hindi. Do not overwrite the project with `bubblewrap update` without preserving these customizations. Gradle uses Maven Central/Google repositories and a pinned wrapper archive checksum.

Install JDK 17 and the Android SDK with platform 36 and build tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME`, then run from the repository root:

```sh
node scripts/build-android.mjs
```

The script assembles APK/AAB, runs Android release lint, aligns/signs the APK, checks that its signing certificate matches `twa-manifest.json`, and generates `releases/android/.well-known/assetlinks.json` and an installer SHA-256 file. The generated APK/AAB and build directories are ignored by Git and excluded from web Docker builds.

Private signing configuration defaults to `~/.jtas/android-signing/signing.json`, overridable with `JTAS_ANDROID_SIGNING_FILE`. Its JSON contains `keystore`, `alias`, `storePassword` and `keyPassword`; both it and the keystore must have mode 600. Keep both outside the repository. Passwords are passed through child-process environment variables, never command arguments. **Back up this directory securely: future APK updates need the same signing key.** No signing password or private key belongs in a commit, Docker image or server release directory.

Increment `versionCode` / `versionName` in `app/build.gradle` and the matching `appVersionCode` / `appVersion` in `twa-manifest.json` for future APK upgrades. When moving domains or using Play App Signing later, update the trusted host and published certificate fingerprints and re-verify links before distribution.

## Deploy the installer

Copy only the generated `.well-known/assetlinks.json`, `downloads/jaraa-android.apk` and its `.sha256` file into `/opt/jtas/releases/android/` with matching paths. The Caddy container mounts that directory read-only and serves only those three paths. APKs contain no account credentials; all job data still requires the web application's authentication and authorization. The public association file must match the signed APK; a failed association falls back to browser chrome and prevents the intended notification attribution.

Validate the Caddy configuration, recreate only Caddy to add the read-only mount, verify the association and installer checksum over HTTPS, and verify normal app/health routes. Preserve the Caddy certificate volumes and all application/data services.

Physical-device delivery, banners and tap behaviour remain acceptance checks. A successful Web Push provider send or signed APK build does not prove that a phone displayed an alert.
