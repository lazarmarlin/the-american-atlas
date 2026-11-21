import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor (Android) app. Build the web assets with `npm run build:app`, then
 * open `android/` in Android Studio. See docs/android-app.md.
 */
const config: CapacitorConfig = {
  // Also the deep-link scheme for sign-in (NATIVE_SCHEME in src/lib/native.ts).
  appId: "com.lazarmarlin.americanatlas",
  appName: "The American Atlas",
  webDir: "dist/client",
  backgroundColor: "#121410",
  server: {
    // Web view origin is https://localhost — listed in src/lib/app-origins.ts.
    androidScheme: "https",
  },
};

export default config;
