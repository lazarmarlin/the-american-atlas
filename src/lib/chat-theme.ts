/**
 * A shared pair of bubble colors. Yours and theirs swap on the other phone,
 * so a message you send is the same color for both of you.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Thread } from "@/lib/messages";

export type SharedTheme = {
  owner: string;
  mine: string;
  theirs: string;
  mineFade: number;
  theirFade: number;
  at: number;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

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
const color = (value: unknown) => (HEX.test(String(value ?? "")) ? String(value) : "");
const fade = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(30, Math.min(100, Math.round(n)));
};

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

type Row = { owner_id: string; mine: string; theirs: string; mine_fade: number; their_fade: number; shared: boolean; updated_at: unknown };

function asTheme(row: Row | undefined): SharedTheme | null {
  if (!row?.shared) return null;
  return {
    owner: row.owner_id,
    mine: color(row.mine),
    theirs: color(row.theirs),
    mineFade: fade(row.mine_fade),
    theirFade: fade(row.their_fade),
    at: toMs(row.updated_at),
  };
}

export const loadTheme = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseThread((input as { thread?: unknown } | null)?.thread))
  .handler(async ({ context, data: thread }): Promise<SharedTheme | null> => {
    const sql = await open(context.userId, thread);
    const key = readKey(thread);
    const rows =
      thread.kind === "group"
        ? await sql<Row>`
            select owner_id, mine, theirs, mine_fade, their_fade, shared, updated_at
            from chat_themes where thread = ${key} and shared = true
            order by updated_at desc limit 1
          `
        : await sql<Row>`
            select owner_id, mine, theirs, mine_fade, their_fade, shared, updated_at
            from chat_themes
            where shared = true
              and ((owner_id = ${context.userId} and thread = ${key}) or (owner_id = ${thread.id} and thread = ${context.userId}))
            order by updated_at desc limit 1
          `;
    return asTheme(rows[0]);
  });

export const saveTheme = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    return {
      thread: parseThread(row.thread),
      mine: color(row.mine),
      theirs: color(row.theirs),
      mineFade: fade(row.mineFade),
      theirFade: fade(row.theirFade),
      shared: row.shared === true,
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await open(context.userId, data.thread);
    const key = readKey(data.thread);
    if (!data.shared && !data.mine && !data.theirs) {
      await sql`delete from chat_themes where owner_id = ${context.userId} and thread = ${key}`;
      return { ok: true };
    }
    await sql`
      insert into chat_themes (owner_id, thread, mine, theirs, mine_fade, their_fade, shared, updated_at)
      values (${context.userId}, ${key}, ${data.mine}, ${data.theirs}, ${data.mineFade}, ${data.theirFade}, ${data.shared}, now())
      on conflict (owner_id, thread) do update set
        mine = excluded.mine,
        theirs = excluded.theirs,
        mine_fade = excluded.mine_fade,
        their_fade = excluded.their_fade,
        shared = excluded.shared,
        updated_at = now()
    `;
    return { ok: true };
  });
