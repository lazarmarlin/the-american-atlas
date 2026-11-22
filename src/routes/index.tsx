import { createFileRoute } from "@tanstack/react-router";
import { AtlasApp } from "@/components/atlas-app";
import { parseSettingsPage, type SettingsPageId } from "@/lib/settings-route";

export const Route = createFileRoute("/")({
  // ?settings=<page> opens Settings as its own history entry (see src/lib/settings-route.ts).
  validateSearch: (search: Record<string, unknown>): { settings?: SettingsPageId } => {
    const settings = parseSettingsPage(search.settings);
    return settings ? { settings } : {};
  },
  component: AtlasApp,
});
