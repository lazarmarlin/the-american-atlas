/**
 * Boards: a to-do, a packing list, or a trip plan. The person who makes one
 * can send it in a chat. A friend can check things off, or change the list,
 * if they were allowed to. src/components/boards-page.tsx.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Thread } from "@/lib/messages";

export type BoardKind = "todo" | "pack" | "trip" | "wish" | "car" | "split";
export type BoardRole = "owner" | "edit" | "check";
/** A place on a wish list (from the atlas). */
export type BoardPlace = { id: string; name: string; state: string; lat: number | null; lon: number | null; category: string };
export type BoardItem = {
  id: string;
  text: string;
  note: string;
  done: boolean;
  /** Wish list: the place, and when it got ticked off by a visit. */
  place?: BoardPlace | null;
  doneOn?: string | null;
  /** Car care: how often, and when it was last done (odometer miles, day). */
  everyMiles?: number | null;
  everyMonths?: number | null;
  lastMiles?: number | null;
  lastDate?: string | null;
  /** Split costs: cents, who paid, who it was for (empty: everyone). A payment settles up between two people. */
  amount?: number | null;
  paidBy?: string | null;
  among?: string[];
  payment?: boolean;
};
export type BoardDoc = {
  start: string | null;
  end: string | null;
  items: BoardItem[];
  /** Car care: an odometer reading and the day it was taken. */
  car?: { odometer: number; at: string } | null;
};
export type BoardCard = { id: string; title: string; kind: BoardKind };
export type BoardPerson = { id: string; name: string };
export type BoardInfo = BoardCard & {
  role: BoardRole;
  updatedAt: number;
  done: number;
  total: number;
  start: string | null;
  end: string | null;
  /** Car care: how many are due or nearly due. Split: the total spent, in cents. */
  due?: number;
  spent?: number;
};
export type BoardOpen = BoardCard & {
  role: BoardRole;
  doc: BoardDoc;
  updatedAt: number;
  /** Everyone on the board (the owner first). */
  people?: BoardPerson[];
  /** Car care: miles tracked since the odometer reading. */
  milesSince?: number;
  /** Who's looking (to say "You"). */
  me?: string;
};

export const BOARD_KINDS: { id: BoardKind; name: string; line: string }[] = [
  { id: "todo", name: "To-do", line: "Things to get done. A friend can check them off." },
  { id: "pack", name: "Packing list", line: "What to bring. Check it off as it goes in the bag." },
  { id: "trip", name: "Trip plan", line: "The stops, and the days, for whoever's coming." },
  { id: "wish", name: "Wish list", line: "Places to get to. Ticks itself off when you do." },
  { id: "car", name: "Car care", line: "Oil, tires, and the rest, due by the miles you drive." },
  { id: "split", name: "Split costs", line: "Who paid for what, and who owes whom." },
];

const BOARD_RE = /^bd-[a-z0-9]{8,24}$/;
const ITEM_RE = /^bi-[a-z0-9]{6,16}$/;
const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GROUP_RE = /^cg-[a-z0-9]{6,24}$/;

const NAMES: Record<BoardKind, string> = { todo: "To-do", pack: "Packing list", trip: "Trip plan", wish: "Wish list", car: "Car care", split: "Split costs" };
const PLACE_RE = /^[\w:._ -]{1,140}$/;

type Sql = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;

export function kindOf(value: unknown): BoardKind {
  return value === "pack" || value === "trip" || value === "wish" || value === "car" || value === "split" ? value : "todo";
}

const whole = (value: unknown, max: number) => {
  const n = value == null || value === "" ? NaN : Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};
const coord = (value: unknown, max: number) => {
  const n = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(n) && Math.abs(n) <= max ? Math.round(n * 1e5) / 1e5 : null;
};

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
    const out: BoardItem = { id, text, note: String(raw.note ?? "").trim().slice(0, 140), done: Boolean(raw.done) };
    const place = raw.place as Record<string, unknown> | null | undefined;
    if (place && PLACE_RE.test(String(place.id ?? ""))) {
      const state = String(place.state ?? "").toUpperCase();
      out.place = {
        id: String(place.id),
        name: String(place.name ?? text).trim().slice(0, 100),
        state: /^[A-Z]{2}$/.test(state) ? state : "",
        lat: coord(place.lat, 90),
        lon: coord(place.lon, 180),
        category: String(place.category ?? "").slice(0, 24),
      };
    }
    if (day(raw.doneOn)) out.doneOn = day(raw.doneOn);
    if (whole(raw.everyMiles, 200000)) out.everyMiles = whole(raw.everyMiles, 200000);
    if (whole(raw.everyMonths, 240)) out.everyMonths = whole(raw.everyMonths, 240);
    if (whole(raw.lastMiles, 3000000) != null) out.lastMiles = whole(raw.lastMiles, 3000000);
    if (day(raw.lastDate)) out.lastDate = day(raw.lastDate);
    if (whole(raw.amount, 100_000_000)) {
      out.amount = whole(raw.amount, 100_000_000);
      out.paidBy = USER_RE.test(String(raw.paidBy ?? "")) ? String(raw.paidBy) : null;
      out.among = (Array.isArray(raw.among) ? raw.among : []).map(String).filter((who) => USER_RE.test(who)).slice(0, 40);
      if (raw.payment) out.payment = true;
    }
    items.push(out);
  }
  const car = row.car as Record<string, unknown> | null | undefined;
  const odometer = car ? whole(car.odometer, 3000000) : null;
  return { start: day(row.start), end: day(row.end), items, ...(car && odometer != null && day(car.at) ? { car: { odometer, at: day(car.at) as string } } : {}) };
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
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const items: BoardItem[] = [];
  for (const me of mine.items) {
    const was = baseById.get(me.id);
    const them = theirById.get(me.id);
    // They removed it and I didn't change it: it stays gone.
    if (was && !them && same(me, was)) continue;
    if (!was || !them) {
      items.push(me);
      continue;
    }
    // Field by field: mine where I changed it, theirs otherwise.
    const merged: Record<string, unknown> = { id: me.id };
    for (const key of new Set([...Object.keys(me), ...Object.keys(them)])) {
      if (key === "id") continue;
      const k = key as keyof BoardItem;
      merged[key] = same(me[k], was[k]) ? them[k] : me[k];
    }
    items.push(merged as BoardItem);
  }
  // Added by them since I loaded it.
  for (const them of theirs.items) if (!mineIds.has(them.id) && !baseById.has(them.id)) items.push(them);
  const car = same(mine.car, base.car) ? theirs.car : mine.car;
  return {
    start: mine.start !== base.start ? mine.start : theirs.start,
    end: mine.end !== base.end ? mine.end : theirs.end,
    items: items.slice(0, 80),
    ...(car ? { car } : {}),
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

async function memberIds(sql: Sql, boardId: string, ownerId: string) {
  const rows = await sql<{ user_id: string }>`select user_id from board_shares where board_id = ${boardId}`;
  return [ownerId, ...rows.map((row) => row.user_id).filter((id) => id !== ownerId)];
}

/** Everyone on the board, with the names they go by. */
async function boardPeople(sql: Sql, boardId: string, ownerId: string): Promise<BoardPerson[]> {
  const ids = await memberIds(sql, boardId, ownerId);
  const { namesFor } = await import("@/lib/messages");
  const names = await namesFor(sql, ids);
  return ids.map((id) => ({ id, name: names.get(id) ?? "Friend" }));
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Wish list: places anyone on the board has on their map get ticked off
 * (with the day they first went). Saves and returns the board's doc if
 * anything changed, plus the names of what was ticked.
 */
async function tickWish(sql: Sql, boardId: string, ownerId: string, doc: BoardDoc): Promise<{ doc: BoardDoc; ticked: string[] }> {
  const open = doc.items.filter((item) => !item.done && item.place?.id);
  if (!open.length) return { doc, ticked: [] };
  const members = await memberIds(sql, boardId, ownerId);
  const ids = open.map((item) => item.place?.id as string);
  const rows = await sql<{ poi_id: string; first: unknown }>`
    select poi_id, min(coalesce(visited_on, created_at::date))::text as first
    from marks where user_id = any(${members}::text[]) and poi_id = any(${ids}::text[])
    group by poi_id
  `;
  if (!rows.length) return { doc, ticked: [] };
  const seen = new Map(rows.map((row) => [row.poi_id, day(String(row.first ?? "").slice(0, 10)) ?? today()]));
  const ticked: string[] = [];
  const items = doc.items.map((item) => {
    const on = !item.done && item.place ? seen.get(item.place.id) : undefined;
    if (!on) return item;
    ticked.push(item.text);
    return { ...item, done: true, doneOn: on };
  });
  const next = { ...doc, items };
  await sql`update boards set doc = ${JSON.stringify(next)}::jsonb, updated_at = now() where id = ${boardId}`;
  return { doc: next, ticked };
}

/** Car care: miles the owner's phones tracked since the odometer reading. */
async function milesSince(sql: Sql, ownerId: string, doc: BoardDoc) {
  if (!doc.car) return 0;
  const rows = await sql<{ miles: number | null }>`
    select coalesce(sum(miles), 0)::float as miles from drive_days where user_id = ${ownerId} and day > ${doc.car.at}::date
  `;
  return Math.round(Number(rows[0]?.miles) || 0);
}

/** How many car jobs are due within 300 miles or 3 weeks. */
export function carDue(doc: BoardDoc, since: number, now = Date.now()) {
  const odometer = doc.car ? doc.car.odometer + since : null;
  return doc.items.filter((item) => {
    const byMiles = item.everyMiles && odometer != null ? (item.lastMiles ?? 0) + item.everyMiles - odometer <= 300 : false;
    const byDate =
      item.everyMonths && item.lastDate
        ? Date.parse(`${item.lastDate}T12:00:00`) + item.everyMonths * 30.44 * 86_400_000 - now <= 21 * 86_400_000
        : false;
    return byMiles || byDate;
  }).length;
}

/** Split costs: cents spent, not counting payments between people. */
export function spentOf(doc: BoardDoc) {
  return doc.items.reduce((sum, item) => sum + (item.payment ? 0 : item.amount ?? 0), 0);
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

/** A board as the phone gets it: with who's on it, wish-list ticks, and car miles. */
async function dressed(
  sql: Sql,
  id: string,
  board: { owner_id: string; kind: string; title: string },
  role: BoardRole,
  doc: BoardDoc,
  updatedAt: number,
  me: string,
): Promise<BoardOpen> {
  const kind = kindOf(board.kind);
  let next = doc;
  let at = updatedAt;
  if (kind === "wish") {
    const ticked = await tickWish(sql, id, board.owner_id, doc);
    if (ticked.ticked.length) at = Date.now();
    next = ticked.doc;
  }
  const out: BoardOpen = { id, title: board.title, kind, role, doc: next, updatedAt: at, me };
  if (kind === "split" || kind === "wish") out.people = await boardPeople(sql, id, board.owner_id);
  if (kind === "car") out.milesSince = await milesSince(sql, board.owner_id, next);
  return out;
}

/**
 * Tick off wish-list places you (or anyone on the list) just got to. Returns
 * what was ticked, for a "checked off" note.
 */
export const tickWishes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ id: string; owner_id: string; title: string; doc: unknown }>`
      select b.id, b.owner_id, b.title, b.doc from boards b
      where b.kind = 'wish' and (b.owner_id = ${context.userId} or exists (select 1 from board_shares s where s.board_id = b.id and s.user_id = ${context.userId}))
      limit 40
    `;
    const ticked: { board: string; place: string }[] = [];
    for (const row of rows) {
      const result = await tickWish(sql, row.id, row.owner_id, readDoc(row.doc));
      for (const place of result.ticked) ticked.push({ board: row.title, place });
    }
    return { ticked };
  });

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
    const out: BoardInfo[] = [];
    for (const row of rows) {
      let doc = readDoc(row.doc);
      const kind = kindOf(row.kind);
      let extra: Partial<BoardInfo> = {};
      if (kind === "wish") doc = (await tickWish(sql, row.id, row.owner_id, doc)).doc;
      if (kind === "car") extra = { due: carDue(doc, await milesSince(sql, row.owner_id, doc)) };
      if (kind === "split") extra = { spent: spentOf(doc) };
      out.push({
        id: row.id,
        kind: kindOf(row.kind),
        title: row.title,
        role: row.owner_id === context.userId ? "owner" : row.role === "edit" ? "edit" : "check",
        updatedAt: toMs(row.updated_at),
        done: doc.items.filter((item) => item.done).length,
        total: doc.items.length,
        start: doc.start,
        end: doc.end,
        ...extra,
      });
    }
    return out;
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
    return dressed(sql, data.id, board, role, readDoc(board.doc), toMs(board.updated_at), context.userId);
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
    return dressed(sql, id, { owner_id: context.userId, kind: data.kind, title: data.title }, "owner", doc, Date.now(), context.userId);
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
    return dressed(sql, data.id, { ...board, title }, role, doc, Date.now(), context.userId);
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
