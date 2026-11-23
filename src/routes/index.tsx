import { createFileRoute } from "@tanstack/react-router";
import { AtlasApp } from "@/components/atlas-app";
import { parseSettingsPage, type SettingsPageId } from "@/lib/settings-route";

export const Route = createFileRoute("/")({
  // ?settings=<page> opens Settings. ?friend=<code> adds that person once you're signed in.
  validateSearch: (search: Record<string, unknown>): { settings?: SettingsPageId; friend?: string } => {
    const settings = parseSettingsPage(search.settings);
    const friend = typeof search.friend === "string" && /^[a-z0-9]{8}$/.test(search.friend) ? search.friend : undefined;
    return { ...(settings ? { settings } : {}), ...(friend ? { friend } : {}) };
  },
  component: AtlasApp,
});
