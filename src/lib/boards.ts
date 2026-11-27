/**
 * Boards: a to-do, a packing list, or a trip plan. The person who makes one
 * can send it in a chat. A friend can check things off, or change the list,
 * if they were allowed to. src/components/boards-page.tsx.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Thread } from "@/lib/messages";

export type BoardKind = "todo" | "pack" | "trip";
export type BoardRole = "owner" | "edit" | "check";
export type BoardItem = { id: string; text: string; note: string; done: boolean };
export type BoardDoc = { start: string | null; end: string | null; items: BoardItem[] };
export type BoardCard = { id: string; title: string; kind: BoardKind };
export type BoardInfo = BoardCard & { role: BoardRole; updatedAt: number; done: number; total: number; start: string | null; end: string | null };
export type BoardOpen = BoardCard & { role: BoardRole; doc: BoardDoc; updatedAt: number };

export const BOARD_KINDS: { id: BoardKind; name: string; line: string }[] = [
  { id: "todo", name: "To-do", line: "Things to get done. A friend can check them off." },
  { id: "pack", name: "Packing list", line: "What to bring. Check it off as it goes in the bag." },
  { id: "trip", name: "Trip plan", line: "The stops, and the days, for whoever's coming." },
];

const BOARD_RE = /^bd-[a-z0-9]{8,24}$/;
const ITEM_RE = /^bi-[a-z0-9]{6,16}$/;
const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GROUP_RE = /^cg-[a-z0-9]{6,24}$/;

const NAMES: Record<BoardKind, string> = { todo: "To-do", pack: "Packing list", trip: "Trip plan" };

type Sql = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;

function kindOf(value: unknown): BoardKind {
  return value === "pack" || value === "trip" ? value : "todo";
}

function day(value: unknown) {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function emptyDoc(): BoardDoc {
  return { start: null, end: null, items: [] };
}

export function cleanDoc(value: unknown): BoardDoc {
  const row = (value ?? {}) as Record<string, unknown>;
  const items: BoardItem[] = [];
  for (const item of Array.isArray(row.items) ? row.items.slice(0, 80) : []) {
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? "");
    const text = String(raw.text ?? "").trim().slice(0, 80);
    if (!ITEM_RE.test(id) || !text) continue;
    items.push({ id, text, note: String(raw.note ?? "").trim().slice(0, 140), done: Boolean(raw.done) });
  }
  return { start: day(row.start), end: day(row.end), items };
}

/**
 * Puts my change on top of what's saved now, given the version I started
 * from, so two people working on one board don't undo each other: anything
 * I didn't touch keeps the other person's version, items they added stay,
 * and items I removed go. My order wins for the items I have.
 */
export function mergeDoc(base: BoardDoc, mine: BoardDoc, theirs: BoardDoc): BoardDoc {
  const baseById = new Map(base.items.map((item) => [item.id, item]));
  const theirById = new Map(theirs.items.map((item) => [item.id, item]));
  const mineIds = new Set(mine.items.map((item) => item.id));
  const pick = <K extends keyof BoardItem>(key: K, was: BoardItem | undefined, me: BoardItem, them: BoardItem | undefined) =>
    !them || !was || me[key] !== was[key] ? me[key] : them[key];
  const items: BoardItem[] = [];
  for (const me of mine.items) {
    const was = baseById.get(me.id);
    const them = theirById.get(me.id);
    // They removed it and I didn't change it: it stays gone.
    if (was && !them && me.text === was.text && me.note === was.note && me.done === was.done) continue;
    items.push({ id: me.id, text: pick("text", was, me, them), note: pick("note", was, me, them), done: pick("done", was, me, them) });
  }
  // Added by them since I loaded it.
  for (const them of theirs.items) if (!mineIds.has(them.id) && !baseById.has(them.id)) items.push(them);
  return {
    start: mine.start !== base.start ? mine.start : theirs.start,
    end: mine.end !== base.end ? mine.end : theirs.end,
    items: items.slice(0, 80),
  };
}

function parseThread(value: unknown): Thread {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = String(row.id ?? "");
  if (row.kind === "group") {
    if (!GROUP_RE.test(id)) throw new Error("Unknown chat");
    return { kind: "group", id };
  }
  if (!USER_RE.test(id)) throw new Error("Unknown friend");
  return { kind: "friend", id };
}

function toMs(value: unknown) {
  const t = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function readDoc(value: unknown): BoardDoc {
  try {
    return cleanDoc(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return emptyDoc();
  }
}

async function loadAccess(sql: Sql, me: string, id: string): Promise<{ board: { owner_id: string; kind: string; title: string; doc: unknown; updated_at: unknown }; role: BoardRole }> {
  const rows = await sql<{ owner_id: string; kind: string; title: string; doc: unknown; updated_at: unknown }>`
    select owner_id, kind, title, doc, updated_at from boards where id = ${id}
  `;
  const board = rows[0];
  if (!board) throw new Error("That board is gone.");
  if (board.owner_id === me) return { board, role: "owner" as const };
  const share = await sql<{ role: string }>`select role from board_shares where board_id = ${id} and user_id = ${me}`;
  const role = share[0]?.role === "edit" ? "edit" : share[0]?.role === "check" ? "check" : null;
  if (!role) throw new Error("You can't open that board.");
  return { board, role };
}

/** Lets the other people in a chat open this board. Only the person who made it. */
export async function grantBoard(sql: Sql, me: string, boardId: string, thread: Thread, role: "check" | "edit"): Promise<BoardCard> {
  if (!BOARD_RE.test(boardId)) throw new Error("Unknown board");
  const rows = await sql<{ owner_id: string; kind: string; title: string }>`
    select owner_id, kind, title from boards where id = ${boardId}
  `;
  const board = rows[0];
  if (!board || board.owner_id !== me) throw new Error("Only the person who made the board can send it.");
  const people =
    thread.kind === "group"
      ? await sql<{ user_id: string }>`select user_id from chat_group_members where group_id = ${thread.id} and user_id <> ${me}`
      : [{ user_id: thread.id }];
  for (const person of people) {
    await sql`
      insert into board_shares (board_id, user_id, role) values (${boardId}, ${person.user_id}, ${role})
      on conflict (board_id, user_id) do update set role = excluded.role
    `;
  }
  return { id: boardId, title: board.title, kind: kindOf(board.kind) };
}

export const listBoards = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<BoardInfo[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ id: string; kind: string; title: string; owner_id: string; role: string | null; updated_at: unknown; doc: unknown }>`
      select b.id, b.kind, b.title, b.owner_id, s.role, b.updated_at, b.doc
      from boards b
      left join board_shares s on s.board_id = b.id and s.user_id = ${context.userId}
      where b.owner_id = ${context.userId} or s.user_id = ${context.userId}
      order by b.updated_at desc
      limit 100
    `;
    return rows.map((row) => {
      const doc = readDoc(row.doc);
      return {
        id: row.id,
        kind: kindOf(row.kind),
        title: row.title,
        role: row.owner_id === context.userId ? "owner" : row.role === "edit" ? "edit" : "check",
        updatedAt: toMs(row.updated_at),
        done: doc.items.filter((item) => item.done).length,
        total: doc.items.length,
        start: doc.start,
        end: doc.end,
      };
    });
  });

export const openBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown } | null)?.id ?? "");
    if (!BOARD_RE.test(id)) throw new Error("Unknown board");
    return { id };
  })
  .handler(async ({ context, data }): Promise<BoardOpen> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const { board, role } = await loadAccess(sql, context.userId, data.id);
    return { id: data.id, title: board.title, kind: kindOf(board.kind), role, doc: readDoc(board.doc), updatedAt: toMs(board.updated_at) };
  });

export const createBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const kind = kindOf(row.kind);
    const title = String(row.title ?? "").trim().slice(0, 60) || NAMES[kind];
    return { kind, title };
  })
  .handler(async ({ context, data }): Promise<BoardOpen> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const id = `bd-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const doc = emptyDoc();
    await sql`
      insert into boards (id, owner_id, kind, title, doc) values (${id}, ${context.userId}, ${data.kind}, ${data.title}, ${JSON.stringify(doc)}::jsonb)
    `;
    return { id, title: data.title, kind: data.kind, role: "owner", doc, updatedAt: Date.now() };
  });

export const saveBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const id = String(row.id ?? "");
    if (!BOARD_RE.test(id)) throw new Error("Unknown board");
    // base: the version this change started from (older apps don't send one).
    return { id, title: String(row.title ?? "").trim().slice(0, 60), doc: cleanDoc(row.doc), base: row.base ? cleanDoc(row.base) : null };
  })
  .handler(async ({ context, data }): Promise<BoardOpen> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const { board, role } = await loadAccess(sql, context.userId, data.id);
    const current = readDoc(board.doc);
    const doc =
      role === "check"
        ? {
            ...current,
            items: current.items.map((item) => {
              const next = data.doc.items.find((candidate) => candidate.id === item.id);
              return next ? { ...item, done: next.done } : item;
            }),
          }
        : data.base
          ? mergeDoc(data.base, data.doc, current)
          : data.doc;
    const title = role === "check" ? board.title : data.title || board.title;
    await sql`update boards set title = ${title}, doc = ${JSON.stringify(doc)}::jsonb, updated_at = now() where id = ${data.id}`;
    return { id: data.id, title, kind: kindOf(board.kind), role, doc, updatedAt: Date.now() };
  });

export const deleteBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown } | null)?.id ?? "");
    if (!BOARD_RE.test(id)) throw new Error("Unknown board");
    return { id };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const { role } = await loadAccess(sql, context.userId, data.id);
    if (role !== "owner") throw new Error("Only the person who made the board can delete it.");
    await sql`delete from boards where id = ${data.id}`;
    return { ok: true };
  });

/** Sends the board into a chat and lets the others open it. */
export const sendBoardTo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const id = String(row.id ?? "");
    if (!BOARD_RE.test(id)) throw new Error("Unknown board");
    return { id, thread: parseThread(row.thread), role: row.role === "edit" ? ("edit" as const) : ("check" as const) };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const allowed =
      data.thread.kind === "group"
        ? await sql<{ ok: boolean }>`select true as ok from chat_group_members where group_id = ${data.thread.id} and user_id = ${context.userId}`
        : await sql<{ ok: boolean }>`select true as ok from friendships where user_id = ${context.userId} and friend_id = ${data.thread.id}`;
    if (!allowed[0]?.ok) throw new Error("You can only send a board to a friend.");
    const card = await grantBoard(sql, context.userId, data.id, data.thread, data.role);
    const messageId = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const body = JSON.stringify(card);
    if (data.thread.kind === "group") {
      await sql`
        insert into group_messages (id, group_id, from_id, kind, body)
        values (${messageId}, ${data.thread.id}, ${context.userId}, 'board', ${body})
      `;
    } else {
      await sql`
        insert into messages (id, from_id, to_id, kind, body)
        values (${messageId}, ${context.userId}, ${data.thread.id}, 'board', ${body})
      `;
    }
    const { pushConfigured, pokeUsers } = await import("@/lib/push.server");
    if (await pushConfigured()) {
      const to =
        data.thread.kind === "group"
          ? (await sql<{ user_id: string }>`select user_id from chat_group_members where group_id = ${data.thread.id} and user_id <> ${context.userId}`).map((row) => row.user_id)
          : [data.thread.id];
      await pokeUsers(to, "message");
    }
    return { id: messageId, board: card };
  });
