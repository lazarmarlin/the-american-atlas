import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { DEFAULT_MARKER_COLOR, DEFAULT_MARKER_ICON, isMarkerColor, isMarkerIcon } from "@/lib/you-marker";

export type Profile = {
  name: string;
  photo: string;
  /** Empty until a marker has been saved on this account. */
  markerIcon: string;
  markerColor: string;
};

function optionalMarker(value: unknown, ok: (value: string) => boolean) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const color = text.startsWith("#") ? text.toLowerCase() : text;
  if (!ok(color)) throw new Error("Pick a marker from the list");
  return color;
}

export const getProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ name: string; photo: string; marker_icon: string | null; marker_color: string | null }>`
      select name, photo, marker_icon, marker_color from profiles where user_id = ${context.userId}
    `;
    const row = rows[0];
    return {
      name: row?.name ?? "",
      photo: row?.photo ?? "",
      markerIcon: isMarkerIcon(row?.marker_icon) ? row.marker_icon : DEFAULT_MARKER_ICON,
      markerColor: isMarkerColor(row?.marker_color) ? row.marker_color.toLowerCase() : DEFAULT_MARKER_COLOR,
    };
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing profile");
    const row = input as Record<string, unknown>;
    const name = String(row.name ?? "").trim().slice(0, 40);
    if (!name) throw new Error("Add a name");
    const photo = String(row.photo ?? "");
    const uploaded = photo.startsWith("data:image/jpeg;base64,");
    const remote = /^https:\/\/\S{1,500}$/.test(photo);
    if (photo && !uploaded && !remote) throw new Error("Use a smaller photo");
    if (uploaded && photo.length > 140000) throw new Error("Use a smaller photo");
    return {
      name,
      photo,
      markerIcon: optionalMarker(row.markerIcon, isMarkerIcon),
      markerColor: optionalMarker(row.markerColor, isMarkerColor),
    };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const icon = data.markerIcon;
    const color = data.markerColor;
    await sql`
      insert into profiles (user_id, name, photo, marker_icon, marker_color)
      values (${context.userId}, ${data.name}, ${data.photo}, ${icon ?? DEFAULT_MARKER_ICON}, ${color ?? DEFAULT_MARKER_COLOR})
      on conflict (user_id) do update set
        name = excluded.name,
        photo = excluded.photo,
        marker_icon = coalesce(${icon}, profiles.marker_icon),
        marker_color = coalesce(${color}, profiles.marker_color),
        updated_at = now()
    `;
    return data;
  });

export const saveMarker = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing marker");
    const row = input as Record<string, unknown>;
    const markerIcon = optionalMarker(row.markerIcon, isMarkerIcon);
    const markerColor = optionalMarker(row.markerColor, isMarkerColor);
    if (!markerIcon || !markerColor) throw new Error("Pick a marker from the list");
    return { markerIcon, markerColor };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      insert into profiles (user_id, name, photo, marker_icon, marker_color)
      values (${context.userId}, '', '', ${data.markerIcon}, ${data.markerColor})
      on conflict (user_id) do update set
        marker_icon = excluded.marker_icon,
        marker_color = excluded.marker_color,
        updated_at = now()
    `;
    return data;
  });
