#!/usr/bin/env node
/**
 * Build the static client for the Capacitor app and copy it into android/.
 *
 *   VITE_API_ORIGIN=https://your-app.vercel.app npm run build:app
 *
 * VITE_API_ORIGIN is the deployed web app the phone talks to for sign-in,
 * saved places and badges. Deploy the web app from the same commit first, so
 * the app's server-function calls match what the server knows.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const origin = (process.env.VITE_API_ORIGIN ?? "").trim().replace(/\/+$/, "");
if (!/^https:\/\/[^/]+$/.test(origin)) {
  console.error(
    "Set VITE_API_ORIGIN to the deployed web app, e.g.\n  VITE_API_ORIGIN=https://your-app.vercel.app npm run build:app",
  );
  process.exit(1);
}

const env = { ...process.env, VITE_NATIVE_APP: "true", VITE_API_ORIGIN: origin };
const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

rmSync("dist", { recursive: true, force: true });
run("node", ["scripts/build-catalog-index.mjs"]);
run("node", ["scripts/with-app-env.mjs", "vite", "build"]);
// The server half of this build isn't used by the app.
rmSync("dist/server", { recursive: true, force: true });
run("npx", ["cap", "sync", "android"]);
console.log(
  `\nApp built against ${origin}. Open android/ in Android Studio (npx cap open android).`,
);
