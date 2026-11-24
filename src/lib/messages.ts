/**
 * A short conversation between two friends. Text, a Google Photos link, or a
 * photo. A photo stays in the chat. It is not a place photo until someone
 * adds it to the map themselves.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type ChatMessage = {
  id: string;
  fromId: string;
  kind: "text" | "link" | "photo";
  body: string;
  thumb: string;
  at: number;
};

const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^m-[a-z0-9]{6,24}$/;
const JPEG = /^data:image\/jpeg;base64,/;
const PHOTO_LINK =
  /^https?:\/\/(?:photos\.app\.goo\.gl|photos\.google\.com|goo\.gl\/photos)\/[^\s]+$/i;

function parseUserId(value: unknown) {
  const id = String(value ?? "");
  if (!USER_RE.test(id)) throw new Error("Unknown friend");
  return id;
}

function parseMessageId(value: unknown) {
  const id = String(value ?? "");
  if (!ID_RE.test(id)) throw new Error("Unknown message");
  return id;
}

function jpeg(value: unknown, max: number, label: string) {
  const text = String(value ?? "");
  if (!JPEG.test(text) || text.length > max) throw new Error(label);
  return text;
}

function toMs(value: unknown) {
  const t = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

async function assertFriend(userId: string, friendId: string) {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{ ok: boolean }>`
    select true as ok from friendships
    where user_id = ${userId} and friend_id = ${friendId}
    limit 1
  `;
  if (!rows[0]?.ok) throw new Error("You can only message a friend.");
  return sql;
}

export const listMessages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseUserId((input as { id?: unknown } | null)?.id))
  .handler(async ({ context, data: friendId }): Promise<ChatMessage[]> => {
    const sql = await assertFriend(context.userId, friendId);
    const rows = await sql<{
      id: string;
      from_id: string;
      kind: string;
      body: string;
      thumb: string | null;
      created_at: unknown;
    }>`
      select id, from_id, kind, body, thumb, created_at
      from messages
      where (from_id = ${context.userId} and to_id = ${friendId})
         or (from_id = ${friendId} and to_id = ${context.userId})
      order by created_at desc
      limit 80
    `;
    return rows
      .reverse()
      .map((row) => ({
        id: row.id,
        fromId: row.from_id,
        kind: row.kind === "link" || row.kind === "photo" ? row.kind : "text",
        body: row.body || "",
        thumb: row.thumb || "",
        at: toMs(row.created_at),
      }));
  });

function parseSend(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Missing message");
  const row = input as Record<string, unknown>;
  const friendId = parseUserId(row.friendId);
  const id = parseMessageId(row.id);
  const kind = row.kind === "link" || row.kind === "photo" ? row.kind : "text";
  if (kind === "photo") {
    return {
      friendId,
      id,
      kind,
      body: "",
      thumb: jpeg(row.thumb, 40000, "That thumbnail is too large"),
      image: jpeg(row.image, 160000, "Use a smaller photo"),
    };
  }
  const body = String(row.body ?? "").trim().slice(0, 500);
  if (!body) throw new Error("Write something first.");
  if (kind === "link" && !PHOTO_LINK.test(body)) throw new Error("That isn't a Google Photos link.");
  return { friendId, id, kind, body, thumb: "", image: "" };
}

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(parseSend)
  .handler(async ({ context, data }) => {
    const sql = await assertFriend(context.userId, data.friendId);
    await sql`
      insert into messages (id, from_id, to_id, kind, body, thumb, image)
      values (
        ${data.id}, ${context.userId}, ${data.friendId}, ${data.kind}, ${data.body},
        ${data.thumb || null}, ${data.image || null}
      )
      on conflict (id) do nothing
    `;
    return { id: data.id };
  });

export const loadMessagePhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseMessageId((input as { id?: unknown } | null)?.id))
  .handler(async ({ context, data: id }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ image: string | null }>`
      select image from messages
      where id = ${id}
        and (from_id = ${context.userId} or to_id = ${context.userId})
    `;
    const image = rows[0]?.image;
    if (!image) throw new Error("That photo isn't in the chat.");
    return { image };
  });
