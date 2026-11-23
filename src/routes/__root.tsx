import { useEffect, useState } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts, useRouter } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { restoreBearerToken } from "@/lib/auth/token";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { nativeApp } from "@/lib/native";
import { hideCoveringSheet } from "@/lib/sheet-back";
import appCss from "../styles.css?url";

const APP_NAME = "The American Atlas";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { title: APP_NAME },
      {
        name: "description",
        content: "A field atlas for the roads, parks, and places you've actually been.",
      },
      { name: "theme-color", content: "#121410" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&family=Outfit:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: RootShell,
});

function RootShell() {
  const [ready, setReady] = useState(!nativeApp);
  useEffect(() => {
    if (!nativeApp) return;
    void restoreBearerToken().finally(() => setReady(true));
  }, []);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <OfflineHost />
        {nativeApp ? <NativeHost /> : null}
        <AuthProvider>{ready ? <Outlet /> : null}</AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}

function OfflineHost() {
  useEffect(() => {
    // The website caches tiles as you look at them. The native app uses the same
    // worker so a saved map picture still draws with no signal.
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

/**
 * Android back button. Settings pages are history entries (see
 * src/lib/settings-route.ts): back steps out of them one at a time. A raised
 * bottom menu lowers instead of leaving. On the bare map it leaves the app,
 * even if the web view still has older entries (from signing in, say).
 */
function NativeHost() {
  const router = useRouter();
  useEffect(() => {
    let remove: (() => void) | undefined;
    void import("@capacitor/app").then(({ App }) =>
      App.addListener("backButton", () => {
        const depth = (window.history.state as { atlasDepth?: number } | null)?.atlasDepth ?? 0;
        const inSettings = new URLSearchParams(window.location.search).has("settings");
        if (depth > 0) window.history.back();
        // Opened straight onto a settings page: nothing of ours to pop, so go up a level.
        else if (inSettings) void router.navigate({ to: "/", search: {}, replace: true });
        else if (hideCoveringSheet()) return;
        else void App.minimizeApp();
      }).then((handle) => {
        remove = () => void handle.remove();
      }),
    );
    return () => remove?.();
  }, [router]);
  return null;
}
