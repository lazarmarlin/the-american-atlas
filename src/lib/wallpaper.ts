/**
 * One picture behind a chat. It stays on this phone unless "Same on their
 * phone" is on, in which case the other person (or the group) sees it too.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Thread } from "@/lib/messages";

export type Wallpaper = { image: string; filter: string; shared: boolean; at: number };

const FILTERS = new Set(["none", "soft", "blur", "pixel", "gray", "warm"]);
const JPEG = /^data:image\/jpeg;base64,/;

function parseThread(value: unknown): Thread {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = String(row.id ?? "");
  if (row.kind === "group") {
    if (!/^cg-[a-z0-9]{6,24}$/.test(id)) throw new Error("Unknown chat");
    return { kind: "group", id };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Unknown friend");
  return { kind: "friend", id };
}

const readKey = (thread: Thread) => (thread.kind === "group" ? `g:${thread.id}` : thread.id);

function toMs(value: unknown) {
  const t = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : 0;
}

async function open(userId: string, thread: Thread) {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows =
    thread.kind === "group"
      ? await sql<{ ok: boolean }>`select true as ok from chat_group_members where group_id = ${thread.id} and user_id = ${userId}`
      : await sql<{ ok: boolean }>`select true as ok from friendships where user_id = ${userId} and friend_id = ${thread.id}`;
  if (!rows[0]?.ok) throw new Error(thread.kind === "group" ? "You're not in that chat." : "You can only message a friend.");
  return sql;
}

/** Your wallpaper, plus one a friend published for this chat. */
export const loadWallpaper = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseThread((input as { thread?: unknown } | null)?.thread))
  .handler(async ({ context, data: thread }): Promise<{ mine: Wallpaper | null; shared: Wallpaper | null }> => {
    const sql = await open(context.userId, thread);
    const key = readKey(thread);
    const mineRows = await sql<{ image: string; filter: string; shared: boolean; updated_at: unknown }>`
      select image, filter, shared, updated_at from chat_wallpapers
      where owner_id = ${context.userId} and thread = ${key}
    `;
    const sharedRows =
      thread.kind === "group"
        ? await sql<{ image: string; filter: string; shared: boolean; updated_at: unknown }>`
            select image, filter, shared, updated_at from chat_wallpapers
            where thread = ${key} and shared = true
            order by updated_at desc
            limit 1
          `
        : await sql<{ image: string; filter: string; shared: boolean; updated_at: unknown }>`
            select image, filter, shared, updated_at from chat_wallpapers
            where owner_id = ${thread.id} and thread = ${context.userId} and shared = true
          `;
    const asWall = (row: { image: string; filter: string; shared: boolean; updated_at: unknown } | undefined): Wallpaper | null =>
      row?.image ? { image: row.image, filter: row.filter, shared: row.shared, at: toMs(row.updated_at) } : null;
    return { mine: asWall(mineRows[0]), shared: asWall(sharedRows[0]) };
  });

export const saveWallpaper = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const thread = parseThread(row.thread);
    const shared = row.shared === true;
    const image = String(row.image ?? "");
    if (image && (!JPEG.test(image) || image.length > 220000)) throw new Error("Use a smaller picture");
    const filter = FILTERS.has(String(row.filter)) ? String(row.filter) : "none";
    return { thread, image, filter, shared };
  })
  .handler(async ({ context, data }) => {
    const sql = await open(context.userId, data.thread);
    const key = readKey(data.thread);
    if (!data.image) {
      await sql`delete from chat_wallpapers where owner_id = ${context.userId} and thread = ${key}`;
      return { ok: true };
    }
    await sql`
      insert into chat_wallpapers (owner_id, thread, image, filter, shared, updated_at)
      values (${context.userId}, ${key}, ${data.image}, ${data.filter}, ${data.shared}, now())
      on conflict (owner_id, thread) do update
        set image = excluded.image, filter = excluded.filter, shared = excluded.shared, updated_at = now()
    `;
    return { ok: true };
  });
