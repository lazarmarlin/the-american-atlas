import { useEffect } from "react";
import {
  allowInstalls,
  checkForUpdate,
  installUpdate,
  resumeAfterPermission,
  sizeText,
  useUpdate,
} from "@/lib/app-update";
import { nativeApp } from "@/lib/native";

/** A card at the top of the map when a newer build of the app is out. */
export function UpdatePrompt() {
  const { available, later, status, percent, message } = useUpdate();

  useEffect(() => {
    if (!nativeApp) return;
    void checkForUpdate();
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      void resumeAfterPermission();
      void checkForUpdate();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);

  if (!nativeApp || !available || later) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-safe z-30 flex justify-center px-4 pt-3">
      <div
        role="status"
        className="pointer-events-auto w-full max-w-sm rounded-card border border-line bg-surface px-4 py-3 shadow-lg"
      >
        <p className="text-xs tracking-widest text-faint uppercase">Update ready</p>
        {status === "permission" ? (
          <>
            <p className="mt-1 text-sm">
              Android needs your OK once: turn on{" "}
              <span className="text-ink">Allow from this source</span>, then come back.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void allowInstalls()}
                className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm"
              >
                Open the setting
              </button>
              <button
                type="button"
                onClick={() => useUpdate.setState({ later: true, status: "idle" })}
                className="h-11 flex-1 rounded-lg border border-line text-sm"
              >
                Later
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm">
              Build {available.build}
              {available.notes ? ` · ${available.notes.split("\n")[0]}` : ""}
            </p>
            <p className="text-xs text-muted">
              Installs over this one. Your places and settings stay.
            </p>
            {message ? <p className="mt-1 text-sm text-accent">{message}</p> : null}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={status === "downloading" || status === "installing"}
                onClick={() => void installUpdate()}
                className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm disabled:text-muted"
              >
                {status === "downloading"
                  ? `Downloading ${percent}%`
                  : status === "installing"
                    ? "Opening the installer…"
                    : `Update${available.size ? ` (${sizeText(available.size)})` : ""}`}
              </button>
              <button
                type="button"
                disabled={status === "downloading"}
                onClick={() => useUpdate.setState({ later: true })}
                className="h-11 flex-1 rounded-lg border border-line text-sm disabled:text-faint"
              >
                Later
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Version line and a check button for Settings → Account. */
export function AppVersion() {
  const { current, available, status, message } = useUpdate();
  useEffect(() => {
    if (nativeApp) void checkForUpdate();
  }, []);
  if (!nativeApp) return null;
  return (
    <section className="mt-8">
      <h2 className="font-serif text-2xl">App version</h2>
      <p className="mt-1 text-sm text-muted">
        {current ? `Build ${current}.` : "Checking…"} New builds install over this one, so nothing
        is lost.
      </p>
      {available ? (
        <button
          type="button"
          onClick={() => {
            useUpdate.setState({ later: false });
            void installUpdate();
          }}
          className="mt-3 h-12 w-full rounded-lg border border-ink bg-elevated text-sm"
        >
          Install build {available.build}
        </button>
      ) : (
        <button
          type="button"
          disabled={status === "checking"}
          onClick={() => void checkForUpdate(true)}
          className="mt-3 h-12 w-full rounded-lg border border-line text-sm disabled:text-faint"
        >
          {status === "checking" ? "Checking…" : "Check for updates"}
        </button>
      )}
      {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
    </section>
  );
}
