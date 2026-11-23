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

const RELEASES = "https://api.github.com/repos/lazarmarlin/the-american-atlas/releases/latest";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

type UpdaterPlugin = {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  install(options: { url: string }): Promise<void>;
  addListener(
    event: "progress",
    fn: (data: { percent: number }) => void,
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
  percent: number;
  message: string | null;
  checkedAt: number;
};

export const useUpdate = create<State>(() => ({
  current: null,
  available: null,
  later: false,
  status: "idle",
  percent: 0,
  message: null,
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
    const res = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok)
      throw new Error(
        res.status === 403 ? "GitHub is busy. Try again later." : "Couldn't check for updates.",
      );
    const release = (await res.json()) as {
      tag_name?: string;
      body?: string;
      assets?: { name: string; browser_download_url: string; size: number }[];
    };
    const latest = Number.parseInt(String(release.tag_name ?? "").replace(/^build-/, ""), 10);
    const asset = release.assets?.find((a) => a.name.endsWith(".apk"));
    const newer = Number.isFinite(latest) && asset && latest > build;
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
    });
  }
}

/** Download the update and open Android's installer. */
export async function installUpdate() {
  const update = useUpdate.getState().available;
  if (!update) return;
  const { allowed } = await Updater.canInstall();
  if (!allowed) {
    useUpdate.setState({ status: "permission", message: null });
    return;
  }
  useUpdate.setState({ status: "downloading", percent: 0, message: null });
  const sub = await Updater.addListener("progress", ({ percent }) =>
    useUpdate.setState({ percent }),
  );
  try {
    await Updater.install({ url: update.url });
    // Android's installer is open now. If they back out of it, the button works again.
    useUpdate.setState({ status: "installing" });
    window.setTimeout(() => {
      if (useUpdate.getState().status === "installing") useUpdate.setState({ status: "idle" });
    }, 8000);
  } catch (err) {
    const text = err instanceof Error ? err.message : "";
    if (text === "needs-permission") useUpdate.setState({ status: "permission" });
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
