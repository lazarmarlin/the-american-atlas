/**
 * Settings lives in the URL (`/?settings=menu`, `/?settings=tracking`, …) so it
 * is a real history entry. That makes the browser's back button and the
 * Android back button (which calls history.back() while there is history — see
 * NativeHost in src/routes/__root.tsx) step from a settings page to the menu,
 * then to the map, instead of leaving the site or closing the app.
 *
 * Each page we open is pushed with `atlasDepth` in its history state, so the
 * on-screen back buttons can pop the same entries the hardware button would.
 * If the page was opened directly (a refresh on ?settings=…), there is nothing
 * of ours to pop, so we replace the entry instead.
 */
import { useNavigate, useRouter, useRouterState, useSearch } from "@tanstack/react-router";

export const SETTINGS_PAGES = ["menu", "account", "tracking", "map", "atlas"] as const;
export type SettingsPageId = (typeof SETTINGS_PAGES)[number];

export function parseSettingsPage(value: unknown): SettingsPageId | undefined {
  return SETTINGS_PAGES.includes(value as SettingsPageId) ? (value as SettingsPageId) : undefined;
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** How many settings pages this app has pushed on top of the map. */
    atlasDepth?: number;
  }
}

export function useSettingsRoute() {
  const search = useSearch({ strict: false }) as { settings?: unknown };
  const page = parseSettingsPage(search.settings) ?? null;
  const depth = useRouterState({ select: (s) => s.location.state.atlasDepth ?? 0 });
  const navigate = useNavigate();
  const router = useRouter();

  const open = (next: SettingsPageId) => {
    void navigate({
      to: "/",
      search: { settings: next },
      state: (prev) => ({ ...prev, atlasDepth: depth + 1 }),
    });
  };

  const replaceWith = (next: SettingsPageId | null) => {
    void navigate({
      to: "/",
      search: next ? { settings: next } : {},
      state: (prev) => ({ ...prev, atlasDepth: 0 }),
      replace: true,
    });
  };

  /** One step back: sub-page → menu → map. */
  const back = () => {
    if (depth > 0) router.history.back();
    else replaceWith(page && page !== "menu" ? "menu" : null);
  };

  /** Straight back to the map, dropping every settings entry we pushed. */
  const close = () => {
    if (depth > 0) router.history.go(-depth);
    else replaceWith(null);
  };

  return { page, open, back, close };
}
