/**
 * Map and trail choices stored on the account, so a reinstall keeps them.
 * Tracking on/off is not one of them: it stays with each device, so signing in
 * somewhere new never starts tracking there. The location marker is saved
 * separately (src/lib/profile.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { BORDER_COLORS, GHOST_COLORS } from "@/lib/atlas-settings";

export type AccountSettings = {
  icons?: boolean;
  stateBorder?: string;
  countyColor?: string;
  fastAdd?: boolean;
  showParks?: boolean;
  showTowns?: boolean;
  showReservations?: boolean;
  showPhotos?: boolean;
  townColor?: string;
  reservationColor?: string;
  ghostHours?: number;
  ghostColor?: string;
  keepGhost?: boolean;
};

const BORDERS = new Set(BORDER_COLORS.map((color) => color.id));
const GHOSTS = new Set(GHOST_COLORS.map((color) => color.id));

function border(value: unknown) {
  const color = String(value ?? "").toLowerCase();
  return BORDERS.has(color) ? color : null;
}

function ghost(value: unknown) {
  const color = String(value ?? "").toLowerCase();
  return GHOSTS.has(color) ? color : null;
}

export function cleanAccountSettings(input: unknown): AccountSettings {
  if (!input || typeof input !== "object") return {};
  const row = input as Record<string, unknown>;
  const next: AccountSettings = {};
  if (typeof row.icons === "boolean") next.icons = row.icons;
  if (typeof row.fastAdd === "boolean") next.fastAdd = row.fastAdd;
  if (typeof row.showParks === "boolean") next.showParks = row.showParks;
  if (typeof row.showTowns === "boolean") next.showTowns = row.showTowns;
  if (typeof row.showReservations === "boolean") next.showReservations = row.showReservations;
  if (typeof row.showPhotos === "boolean") next.showPhotos = row.showPhotos;
  if (typeof row.keepGhost === "boolean") next.keepGhost = row.keepGhost;
  const stateBorder = border(row.stateBorder);
  const countyColor = border(row.countyColor);
  const townColor = border(row.townColor);
  const reservationColor = border(row.reservationColor);
  const ghostColor = ghost(row.ghostColor);
  if (stateBorder) next.stateBorder = stateBorder;
  if (countyColor) next.countyColor = countyColor;
  if (townColor) next.townColor = townColor;
  if (reservationColor) next.reservationColor = reservationColor;
  if (ghostColor) next.ghostColor = ghostColor;
  const hours = Math.round(Number(row.ghostHours));
  if (Number.isFinite(hours)) next.ghostHours = Math.min(24, Math.max(1, hours));
  return next;
}

function asSettings(value: unknown): AccountSettings {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  return cleanAccountSettings(raw);
}

export const loadAccountSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ settings: unknown }>`
      select settings from profiles where user_id = ${context.userId}
    `;
    return asSettings(rows[0]?.settings ?? {});
  });

export const saveAccountSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => cleanAccountSettings(input))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const payload = JSON.stringify(data);
    await sql`
      insert into profiles (user_id, name, photo, settings)
      values (${context.userId}, '', '', ${payload}::jsonb)
      on conflict (user_id) do update set settings = excluded.settings, updated_at = now()
    `;
    return data;
  });
