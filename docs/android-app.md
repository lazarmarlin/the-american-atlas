# Android app (Capacitor)

The Android app runs the same React UI as the website. The screens and all of
`public/atlas` ship inside the app, so browsing works offline. Sign-in, saved
places, trips and badges go to the deployed web app on Vercel.

## How it fits together

| Piece | Where |
| --- | --- |
| Capacitor config (app id, web dir) | `capacitor.config.ts` |
| Android Studio project | `android/` |
| Build switches (`VITE_NATIVE_APP`, `VITE_API_ORIGIN`) | `src/lib/native.ts` |
| Server-function calls sent to the web app with the bearer token | `src/start.ts` |
| CORS + CSRF for the app's web view origin (`https://localhost`) | `src/start.ts`, `src/lib/app-origins.ts`, `src/lib/auth/isolation.server.ts` |
| Google / X sign-in in the system browser | `src/lib/auth/native-signin.ts` (app), `src/lib/auth/native.server.ts` + `src/routes/auth/native*.ts` (server) |
| One-time sign-in codes table | `migrations/0007_native_auth.sql` |

The app signs in with a **bearer token** that it keeps in local storage. It never
uses cookies across origins.

**Email and password** sign-in works directly inside the app.

**Google and X** open a Chrome Custom Tab:

1. The tab goes to `/auth/native` on the web app and runs the normal Grok
   sign-in there.
2. It returns to the app at `com.lazarmarlin.americanatlas://auth?code=…`.
3. The app trades that code, plus a secret it never sent anywhere (PKCE), for
   a session token at `/auth/native-exchange`.

## Build it

1. **Deploy the web app first, from the same commit.** Server-function IDs come
   from file paths and function names, so the app and the server need to match.
   The deploy also applies the `0007` migration.
2. Build the app assets and copy them into `android/`:

   ```sh
   VITE_API_ORIGIN=https://your-app.vercel.app npm run build:app
   ```

3. Open the project with `npm run open:android` (needs Android Studio), then
   press Run. Or build from the command line:

   ```sh
   cd android && ./gradlew assembleDebug
   # → android/app/build/outputs/apk/debug/app-debug.apk
   ```

### Without Android Studio

The **Android APK** GitHub Action (`.github/workflows/android.yml`) builds a
debug APK on every push to `main`. You can also start it by hand from the
Actions tab.

To set it up:

1. Add a repository variable `API_ORIGIN` under Settings → Secrets and
   variables → Actions → Variables.
2. After a run, download the APK from the run's Artifacts section.
3. Install it on the phone. You'll need to allow installs from unknown sources.

## Release builds

Debug APKs are signed with a throwaway debug key. For the Play Store:

1. Create an upload keystore.
2. Add a `signingConfigs.release` block to `android/app/build.gradle`.
3. Run `./gradlew bundleRelease`.

Keep the keystore out of git.

## Icons and splash

The source art is in `assets/`. It comes from `public/__grok/icon-512.png` on
the `#121410` background. The generated launcher icons and splash screens are
in `android/app/src/main/res/`.

## Notifications

When travel tracking adds places, the app posts a notification on the
"Places added" channel. For example: "Added Fulton County · Saved to your atlas
· +10 pts", or "Added 3 places" followed by their names.

- Code: `src/lib/place-notifications.ts`
- Icon: `ic_stat_atlas` in `android/app/src/main/res/drawable-*`

Android asks for notification permission once, together with location, when
tracking is turned on. The app never asks while running in the background. If
the permission is off, places are still added, just without a notification.
