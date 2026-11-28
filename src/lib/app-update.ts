/**
 * Updates for the Android app. Every build from main is published as a GitHub
 * release named build-N (see .github/workflows/android.yml). The app compares
 * N with its own build number and, when newer, downloads the APK and hands it
 * to Android's installer (ApkUpdaterPlugin.java). The update installs over the
 * app, so places, settings and sign-in stay.
 */
import { registerPlugin } from "@capacitor/core";
import { create } from "zustand";
import { nativeApp } from "@/lib/native";

const REPO = "https://api.github.com/repos/lazarmarlin/the-american-atlas/releases";
/**
 * "test": the test app (built from a test/… branch, installed alongside the
 * real one) updates from its own builds, test-N, published as pre-releases.
 * The real app only ever sees /latest, which never is a pre-release.
 */
const TEST_APP = import.meta.env.VITE_UPDATE_CHANNEL === "test";
/** Looked for when the app comes to the front, at most this often (one small request). */
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** A check that failed (no signal) is tried again after this long instead of the full wait. */
const RETRY_AFTER_MS = 5 * 60 * 1000;

type UpdaterPlugin = {
  canInstall(): Promise<{ allowed: boolean }>;
  /** Newer apps: download now, install later (installReady). */
  download(options: { url: string }): Promise<{ bytes: number }>;
  ready(): Promise<{ ready: boolean }>;
  installReady(): Promise<void>;
  lastError(): Promise<{ message: string; aborted?: boolean }>;
  openInstallSettings(): Promise<void>;
  install(options: { url: string }): Promise<void>;
  addListener(
    event: "progress",
    fn: (data: { percent: number; bytes?: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
};

const Updater = registerPlugin<UpdaterPlugin>("ApkUpdater");

export type UpdateInfo = { build: number; url: string; notes: string; size: number };

type State = {
  current: number | null;
  available: UpdateInfo | null;
  /** The prompt was put off until the next launch. */
  later: boolean;
  status: "idle" | "checking" | "downloading" | "installing" | "permission" | "error";
  /** The update is downloaded and installs on its own (see AutoUpdate). */
  ready: boolean;
  /** Downloading quietly in the background (no prompt). */
  background: boolean;
  percent: number;
  message: string | null;
  /** Why the last install didn't go through, to show once. */
  failed: string | null;
  checkedAt: number;
};

export const useUpdate = create<State>(() => ({
  current: null,
  available: null,
  later: false,
  status: "idle",
  ready: false,
  background: false,
  percent: 0,
  message: null,
  failed: null,
  checkedAt: 0,
}));

async function currentBuild() {
  const known = useUpdate.getState().current;
  if (known != null) return known;
  const { App } = await import("@capacitor/app");
  const info = await App.getInfo();
  const build = Number.parseInt(info.build, 10) || 0;
  useUpdate.setState({ current: build });
  return build;
}

/** Look for a newer build. Quiet unless `force` (the settings button). */
export async function checkForUpdate(force = false) {
  if (!nativeApp) return;
  const state = useUpdate.getState();
  if (!force && Date.now() - state.checkedAt < CHECK_EVERY_MS) return;
  if (state.status === "downloading" || state.status === "installing") return;
  useUpdate.setState({ status: "checking", message: null, checkedAt: Date.now() });
  try {
    const build = await currentBuild();
    const res = await fetch(TEST_APP ? `${REPO}?per_page=30` : `${REPO}/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok)
      throw new Error(
        res.status === 403 ? "GitHub is busy. Try again later." : "Couldn't check for updates.",
      );
    type Release = {
      tag_name?: string;
      body?: string;
      draft?: boolean;
      assets?: { name: string; browser_download_url: string; size: number }[];
    };
    const found = (await res.json()) as Release | Release[];
    const release: Release = Array.isArray(found)
      ? found
          .filter((item) => !item.draft && /^test-\d+$/.test(item.tag_name ?? ""))
          .sort((a, b) => Number.parseInt(String(b.tag_name).slice(5), 10) - Number.parseInt(String(a.tag_name).slice(5), 10))[0] ?? {}
      : found;
    const latest = Number.parseInt(String(release.tag_name ?? "").replace(/^(build|test)-/, ""), 10);
    const asset = release.assets?.find((a) => a.name.endsWith(".apk"));
    const newer = Number.isFinite(latest) && asset && latest > build;
    if (newer) void downloadQuietly({ build: latest, url: asset.browser_download_url, notes: release.body ?? "", size: asset.size });
    useUpdate.setState({
      status: "idle",
      available: newer
        ? {
            build: latest,
            url: asset.browser_download_url,
            notes: release.body ?? "",
            size: asset.size,
          }
        : null,
      message: force && !newer ? "You have the newest version." : null,
    });
  } catch (err) {
    useUpdate.setState({
      status: force ? "error" : "idle",
      message: force ? (err instanceof Error ? err.message : "Couldn't check for updates.") : null,
      checkedAt: Date.now() - CHECK_EVERY_MS + RETRY_AFTER_MS,
    });
  }
}

/** The background download (downloadQuietly) has finished, one way or the other. */
function backgroundDone() {
  return new Promise<void>((resolve) => {
    if (!useUpdate.getState().background) return resolve();
    const stop = useUpdate.subscribe((state) => {
      if (state.background) return;
      stop();
      resolve();
    });
  });
}

/**
 * The Update button: install the update, downloading it first if it isn't
 * already. If it's already downloading in the background, that download is
 * waited for (its progress shows) rather than a second one started: two at
 * once wrote over each other's file, the bar jumped about, and one ended in
 * "Couldn't save the update".
 */
export async function installUpdate() {
  const update = useUpdate.getState().available;
  if (!update || useUpdate.getState().status === "downloading") return;
  const { allowed } = await Updater.canInstall();
  if (!allowed) {
    useUpdate.setState({ status: "permission", message: null });
    return;
  }
  if (useUpdate.getState().background) {
    useUpdate.setState({ status: "downloading", message: null });
    await backgroundDone();
    useUpdate.setState({ status: "idle" });
  }
  if (useUpdate.getState().ready) {
    await installReadyUpdate();
    // Installed from the download (the app closes); if that build couldn't, download it fresh below.
    if (useUpdate.getState().ready || useUpdate.getState().status !== "idle") return;
  }
  useUpdate.setState({ status: "downloading", percent: 0, message: null });
  const sub = await Updater.addListener("progress", ({ percent, bytes }) => {
    const size = useUpdate.getState().available?.size ?? 0;
    const fromBytes = size > 0 && bytes ? Math.min(99, Math.round((bytes * 100) / size)) : 0;
    const next = percent >= 0 ? percent : fromBytes;
    useUpdate.setState({ percent: next });
  });
  try {
    await Updater.install({ url: update.url });
    // Android's installer is open now. If they back out of it, the button works again.
    useUpdate.setState({ status: "installing", message: null });
    window.setTimeout(() => {
      if (useUpdate.getState().status === "installing") useUpdate.setState({ status: "idle" });
    }, 8000);
  } catch (err) {
    const text = err instanceof Error ? err.message : "";
    if (text === "needs-permission") useUpdate.setState({ status: "permission", message: null });
    else
      useUpdate.setState({
        status: "error",
        message: text || "The update didn't download. Try again.",
      });
  } finally {
    void sub.remove();
  }
}

/** Android's "Install unknown apps" switch for this app. */
export async function allowInstalls() {
  await Updater.openInstallSettings();
}

/** After coming back from that switch, carry on if it's now on. */
export async function resumeAfterPermission() {
  if (useUpdate.getState().status !== "permission") return;
  const { allowed } = await Updater.canInstall();
  if (allowed) void installUpdate();
}

export function sizeText(bytes: number) {
  return bytes > 0 ? `${(bytes / 1_048_576).toFixed(1)} MB` : "";
}

const READY_KEY = "atlas.update-ready";

/**
 * Self-updating: a newer build downloads in the background as soon as it's
 * found, then installs the next time the app is open and you're not driving
 * (AutoUpdate in update-prompt.tsx). Older app builds without the native
 * download fall back to the Update button.
 */
async function downloadQuietly(update: UpdateInfo) {
  const state = useUpdate.getState();
  if (state.background || state.status === "downloading") return;
  try {
    if (localStorage.getItem(READY_KEY) === String(update.build) && (await Updater.ready()).ready) {
      useUpdate.setState({ ready: true });
      return;
    }
  } catch {
    // An older app: no background download.
    return;
  }
  useUpdate.setState({ background: true, percent: 0 });
  const sub = await Updater.addListener("progress", ({ percent }) => {
    if (percent >= 0) useUpdate.setState({ percent });
  }).catch(() => null);
  try {
    await Updater.download({ url: update.url });
    localStorage.setItem(READY_KEY, String(update.build));
    useUpdate.setState({ ready: true, background: false });
  } catch {
    // Next check tries again.
    useUpdate.setState({ background: false });
  } finally {
    void sub?.remove();
  }
}

let installWatch = 0;

/**
 * The install didn't replace the app (cancelled on Android's screen, or it
 * failed): stop saying "installing", and leave it until the next launch
 * instead of trying again every few seconds.
 */
async function installGaveUp(why: string | null) {
  window.clearTimeout(installWatch);
  if (useUpdate.getState().status !== "installing") return;
  // A download that won't install (cut short, wrong build) is fetched again next time.
  if (why) useUpdate.setState({ ready: false, failed: why });
  useUpdate.setState({ status: "idle", later: true, message: null });
}

/** While "installing" shows: has Android said it didn't go through? */
export async function checkInstallOutcome() {
  if (useUpdate.getState().status !== "installing") return;
  try {
    const { message, aborted } = await Updater.lastError();
    if (message || aborted) await installGaveUp(message || null);
  } catch {
    // Still installing, as far as we know.
  }
}

/** Install the downloaded update now (the app closes and reopens). */
export async function installReadyUpdate() {
  if (useUpdate.getState().status === "installing") return;
  try {
    await Updater.installReady();
    useUpdate.setState({ status: "installing", message: null });
    // Normally the app is replaced within seconds and none of this runs.
    // A refusal (bad file, cancelled) usually comes back within seconds.
    window.setTimeout(() => void checkInstallOutcome(), 15_000);
    window.clearTimeout(installWatch);
    installWatch = window.setTimeout(() => {
      void checkInstallOutcome().then(() => installGaveUp(null));
    }, 120_000);
  } catch (err) {
    const text = err instanceof Error ? err.message : "";
    if (text === "needs-permission") useUpdate.setState({ status: "permission", message: null });
    else if (/not implemented|No update downloaded/i.test(text)) useUpdate.setState({ ready: false });
    else useUpdate.setState({ status: "error", message: text || "The update didn't install." });
  }
}

/** A failed install from last time, to show once. */
export async function lastInstallError() {
  try {
    const { message } = await Updater.lastError();
    return message || null;
  } catch {
    return null;
  }
}
