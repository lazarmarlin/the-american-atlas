/**
 * Conversations: one friend, or a trip group (src/lib/chat-groups.ts). Text, a
 * Google Photos link, a photo, or a place card. A photo stays in the chat until
 * someone adds it to the map themselves; it keeps where and when it was taken,
 * so the app can suggest the place.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { TripCard } from "@/lib/trips";
import { trailCard, type ChatTrail } from "@/lib/trail-card";

export type ChatPlace = {
  id: string;
  name: string;
  category: string;
  state: string;
  lat: number | null;
  lon: number | null;
  points: number;
  visitedOn: string | null;
};

export type ChatReaction = { up: number; heart: number; pin: number; mine: ("up" | "heart" | "pin")[] };

export type ChatReply = { id: string; name: string; text: string };

export type { ChatTrail };

export type ChatMessage = {
  id: string;
  fromId: string;
  fromName: string;
  kind: "text" | "link" | "photo" | "place" | "trip" | "trail";
  body: string;
  thumb: string;
  at: number;
  lat: number | null;
  lon: number | null;
  takenAt: number | null;
  place: ChatPlace | null;
  trip?: TripCard | null;
  trail?: ChatTrail | null;
  reply?: ChatReply | null;
  reactions?: ChatReaction;
  /** Stuck to the top of this chat. */
  pinned?: boolean;
  /** True on a message you sent once everyone else in the chat has opened it. */
  read?: boolean;
  /** When they last opened the chat, if they've seen this message. */
  readAt?: number | null;
};

export type Thread = { kind: "friend" | "group"; id: string };

type Sql = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;

const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GROUP_RE = /^cg-[a-z0-9]{6,24}$/;
const ID_RE = /^m-[a-z0-9]{6,24}$/;
const PLACE_RE = /^[\w:._ -]{1,140}$/;
const JPEG = /^data:image\/jpeg;base64,/;
const PHOTO_LINK = /^https?:\/\/(?:photos\.app\.goo\.gl|photos\.google\.com|goo\.gl\/photos)\/[^\s]+$/i;

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

const num = (value: unknown, limit: number) => {
  const n = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

function toMs(value: unknown) {
  const t = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

const readKey = (thread: Thread) => (thread.kind === "group" ? `g:${thread.id}` : thread.id);

/** The time through which everyone else in the chat has opened it. 0 if someone hasn't. */
async function readThroughAt(sql: Sql, me: string, thread: Thread) {
  if (thread.kind === "friend") {
    const rows = await sql<{ read_at: unknown }>`
      select read_at from message_reads where user_id = ${thread.id} and thread = ${me}
    `;
    return rows[0] ? toMs(rows[0].read_at) : 0;
  }
  const members = await sql<{ user_id: string }>`
    select user_id from chat_group_members where group_id = ${thread.id} and user_id <> ${me}
  `;
  if (!members.length) return 0;
  const reads = await sql<{ user_id: string; read_at: unknown }>`
    select user_id, read_at from message_reads where thread = ${readKey(thread)} and user_id <> ${me}
  `;
  const at = new Map(reads.map((row) => [row.user_id, toMs(row.read_at)]));
  if (!members.every((member) => at.has(member.user_id))) return 0;
  return Math.min(...members.map((member) => at.get(member.user_id) ?? 0));
}

/** Throws unless you may read and write this conversation. */
async function openThread(userId: string, thread: Thread): Promise<Sql> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows =
    thread.kind === "group"
      ? await sql<{ ok: boolean }>`select true as ok from chat_group_members where group_id = ${thread.id} and user_id = ${userId}`
      : await sql<{ ok: boolean }>`select true as ok from friendships where user_id = ${userId} and friend_id = ${thread.id}`;
  if (!rows[0]?.ok) throw new Error(thread.kind === "group" ? "You're not in that chat." : "You can only message a friend.");
  return sql;
}

export async function namesFor(sql: Sql, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await sql<{ id: string; name: string }>`
    select u.id, coalesce(nullif(p.name, ''), nullif(u.name, ''), 'Friend') as name
    from "user" u left join profiles p on p.user_id = u.id
    where u.id = any(${ids}::text[])
  `;
  return new Map(rows.map((row) => [row.id, row.name]));
}

const KINDS = ["link", "photo", "place", "trip", "trail"] as const;
function kindOf(value: unknown): ChatMessage["kind"] {
  return (KINDS as readonly unknown[]).includes(value) ? (value as ChatMessage["kind"]) : "text";
}

function fin(value: unknown, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
}

/** A trip recap from a phone, checked and trimmed to sensible sizes. */
function cleanTripCard(value: unknown): TripCard {
  const row = (value ?? {}) as Record<string, unknown>;
  const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null);
  const coord = (v: unknown): [number, number] | null => {
    if (!Array.isArray(v)) return null;
    const lon = Number(v[0]);
    const lat = Number(v[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
      ? [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]
      : null;
  };
  let budget = 500;
  const lines: [number, number][][] = [];
  for (const line of Array.isArray(row.lines) ? row.lines.slice(0, 40) : []) {
    if (!Array.isArray(line) || budget <= 0) continue;
    const pts = line.slice(0, budget).map(coord).filter((p): p is [number, number] => !!p);
    budget -= pts.length;
    if (pts.length > 1) lines.push(pts);
  }
  const dots = (Array.isArray(row.dots) ? row.dots.slice(0, 200) : [])
    .map((d) => {
      const c = coord(d);
      return c ? ([c[0], c[1], Array.isArray(d) && d[2] ? 1 : 0] as [number, number, number]) : null;
    })
    .filter((d): d is [number, number, number] => !!d);
  const name = String(row.name ?? "").trim().slice(0, 80);
  if (!name) throw new Error("Missing trip");
  return {
    name,
    from: day(row.from),
    to: day(row.to),
    miles: Math.round(fin(row.miles, 50000) * 10) / 10,
    places: Math.round(fin(row.places, 100000)),
    fresh: Math.round(fin(row.fresh, 100000)),
    states: (Array.isArray(row.states) ? row.states : []).map((s) => String(s).toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)).slice(0, 60),
    counties: Math.round(fin(row.counties, 4000)),
    points: Math.round(fin(row.points, 10000000)),
    lines,
    dots,
  };
}

function readTrip(body: string): TripCard | null {
  try {
    return cleanTripCard(JSON.parse(body));
  } catch {
    return null;
  }
}

function readPlace(body: string): ChatPlace | null {
  try {
    const row = JSON.parse(body) as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") return null;
    return {
      id: row.id,
      name: row.name,
      category: String(row.category ?? ""),
      state: String(row.state ?? ""),
      lat: num(row.lat, 90),
      lon: num(row.lon, 180),
      points: Number(row.points) || 0,
      visitedOn: typeof row.visitedOn === "string" ? row.visitedOn : null,
    };
  } catch {
    return null;
  }
}

type Row = {
  id: string;
  from_id: string;
  kind: string;
  body: string;
  thumb: string | null;
  lat: number | null;
  lon: number | null;
  taken_at: number | null;
  reply_to: string | null;
  created_at: unknown;
};

const MARKS = ["up", "heart", "pin"] as const;
type Mark = (typeof MARKS)[number];

function quoteOf(kind: ChatMessage["kind"], body: string) {
  if (kind === "photo") return "Photo";
  if (kind === "link") return "Google Photos";
  if (kind === "place") return readPlace(body)?.name || "A place";
  if (kind === "trip") return readTrip(body)?.name || "A trip";
  if (kind === "trail") return readTrail(body)?.name || "A trail";
  return (body || "").slice(0, 80);
}

function readTrail(body: string): ChatTrail | null {
  try {
    const row = JSON.parse(body) as ChatTrail;
    if (!row || typeof row.name !== "string" || !Array.isArray(row.lines)) return null;
    return row;
  } catch {
    return null;
  }
}

async function listRows(sql: Sql, userId: string, thread: Thread): Promise<Row[]> {
  if (thread.kind === "group") {
    return sql<Row>`
      select id, from_id, kind, body, thumb, lat, lon, taken_at, reply_to, created_at
      from group_messages m
      where group_id = ${thread.id}
        and not exists (select 1 from message_hidden h where h.user_id = ${userId} and h.message_id = m.id)
      order by created_at desc
      limit 100
    `;
  }
  return sql<Row>`
    select id, from_id, kind, body, thumb, lat, lon, taken_at, reply_to, created_at
    from messages m
    where ((from_id = ${userId} and to_id = ${thread.id}) or (from_id = ${thread.id} and to_id = ${userId}))
      and not exists (select 1 from message_hidden h where h.user_id = ${userId} and h.message_id = m.id)
    order by created_at desc
    limit 100
  `;
}

/** The conversation, oldest first. Opening it marks it read. */
export const listThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseThread((input as { thread?: unknown } | null)?.thread))
  .handler(async ({ context, data: thread }): Promise<ChatMessage[]> => {
    const sql = await openThread(context.userId, thread);
    const rows = (await listRows(sql, context.userId, thread)).reverse();
    const names = await namesFor(sql, [...new Set(rows.map((row) => row.from_id))]);
    await sql`
      insert into message_reads (user_id, thread, read_at) values (${context.userId}, ${readKey(thread)}, now())
      on conflict (user_id, thread) do update set read_at = now()
    `;
    const readThrough = await readThroughAt(sql, context.userId, thread);
    const ids = rows.map((row) => row.id);
    const reactionRows = ids.length
      ? await sql<{ message_id: string; user_id: string; mark: string }>`
          select message_id, user_id, mark from message_reactions where message_id = any(${ids}::text[])
        `
      : [];
    const pinRows = await sql<{ message_id: string }>`
      select message_id from thread_pins where thread = ${readKey(thread)}
    `;
    const pinId = pinRows[0]?.message_id ?? "";
    const byId = new Map(rows.map((row) => [row.id, row]));
    return rows.map((row) => {
      const kind = kindOf(row.kind);
      const at = toMs(row.created_at);
      const marks = reactionRows.filter((item) => item.message_id === row.id);
      const reactions: ChatReaction = { up: 0, heart: 0, pin: 0, mine: [] };
      for (const mark of marks) {
        if (mark.mark === "up" || mark.mark === "heart" || mark.mark === "pin") {
          reactions[mark.mark] += 1;
          if (mark.user_id === context.userId) reactions.mine.push(mark.mark);
        }
      }
      const source = row.reply_to ? byId.get(row.reply_to) : undefined;
      const reply: ChatReply | null = row.reply_to
        ? {
            id: row.reply_to,
            name: source ? names.get(source.from_id) ?? "Friend" : "",
            text: source ? quoteOf(kindOf(source.kind), source.body) : "Earlier message",
          }
        : null;
      return {
        id: row.id,
        fromId: row.from_id,
        fromName: names.get(row.from_id) ?? "Friend",
        kind,
        body: kind === "place" || kind === "trip" || kind === "trail" ? "" : row.body || "",
        thumb: row.thumb || "",
        at,
        lat: row.lat ?? null,
        lon: row.lon ?? null,
        takenAt: row.taken_at ?? null,
        place: kind === "place" ? readPlace(row.body) : null,
        trip: kind === "trip" ? readTrip(row.body) : null,
        trail: kind === "trail" ? readTrail(row.body) : null,
        reply,
        reactions,
        pinned: row.id === pinId,
        read: row.from_id === context.userId && readThrough > 0 && at <= readThrough,
        readAt: row.from_id === context.userId && readThrough > 0 && at <= readThrough ? readThrough : null,
      };
    });
  });

function parseSend(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Missing message");
  const row = input as Record<string, unknown>;
  // Older app builds send a friendId instead of a thread.
  const thread = parseThread(row.thread ?? { kind: "friend", id: row.friendId });
  const id = parseMessageId(row.id);
  const kind = kindOf(row.kind);
  const base = {
    thread,
    id,
    kind,
    body: "",
    thumb: "",
    image: "",
    lat: null as number | null,
    lon: null as number | null,
    takenAt: null as number | null,
    replyTo: row.replyTo ? parseMessageId(row.replyTo) : "",
  };
  if (kind === "photo") {
    const taken = num(row.takenAt, 1e13);
    return {
      ...base,
      thumb: jpeg(row.thumb, 120000, "That thumbnail is too large"),
      image: jpeg(row.image, 700000, "Use a smaller photo"),
      lat: num(row.lat, 90),
      lon: num(row.lon, 180),
      takenAt: taken && taken > 0 ? Math.round(taken) : null,
    };
  }
  if (kind === "trip") {
    return { ...base, body: JSON.stringify(cleanTripCard(row.trip)) };
  }
  if (kind === "trail") {
    const card = (row.trail ?? {}) as Record<string, unknown>;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(card.day ?? "")) ? String(card.day) : null;
    return { ...base, body: JSON.stringify(trailCard(String(card.name ?? ""), card.points, day)) };
  }
  if (kind === "place") {
    const place = (row.place ?? {}) as Record<string, unknown>;
    const poiId = String(place.id ?? "");
    const state = String(place.state ?? "").toUpperCase();
    if (!PLACE_RE.test(poiId) || !/^[A-Z]{2}$/.test(state)) throw new Error("Unknown place");
    const visitedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(place.visitedOn ?? "")) ? String(place.visitedOn) : null;
    // Name, kind and points are filled in from the atlas by the handler.
    const card: ChatPlace = { id: poiId, name: "", category: "", state, lat: num(place.lat, 90), lon: num(place.lon, 180), points: 0, visitedOn };
    return { ...base, body: JSON.stringify(card), lat: card.lat, lon: card.lon };
  }
  const body = String(row.body ?? "").trim().slice(0, 500);
  if (!body) throw new Error("Write something first.");
  if (kind === "link" && !PHOTO_LINK.test(body)) throw new Error("That isn't a Google Photos link.");
  return { ...base, body };
}

export const sendToThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(parseSend)
  .handler(async ({ context, data }) => {
    const sql = await openThread(context.userId, data.thread);
    if (data.kind === "place") {
      // The atlas's own name, kind and points, not what the phone says.
      const card = JSON.parse(data.body) as ChatPlace;
      const { canonicalPlace } = await import("@/lib/catalog.server");
      const real = await canonicalPlace(card.id, card.state);
      if (!real) throw new Error("Unknown place");
      data = { ...data, body: JSON.stringify({ ...card, name: real.name, category: real.category, points: real.points }) };
    }
    if (data.replyTo) {
      const found =
        data.thread.kind === "group"
          ? await sql<{ id: string }>`select id from group_messages where id = ${data.replyTo} and group_id = ${data.thread.id}`
          : await sql<{ id: string }>`
              select id from messages
              where id = ${data.replyTo}
                and ((from_id = ${context.userId} and to_id = ${data.thread.id}) or (from_id = ${data.thread.id} and to_id = ${context.userId}))
            `;
      if (!found.length) data = { ...data, replyTo: "" };
    }
    if (data.thread.kind === "group") {
      await sql`
        insert into group_messages (id, group_id, from_id, kind, body, thumb, image, lat, lon, taken_at, reply_to)
        values (${data.id}, ${data.thread.id}, ${context.userId}, ${data.kind}, ${data.body},
          ${data.thumb || null}, ${data.image || null}, ${data.lat}, ${data.lon}, ${data.takenAt}, ${data.replyTo || null})
        on conflict (id) do nothing
      `;
    } else {
      await sql`
        insert into messages (id, from_id, to_id, kind, body, thumb, image, lat, lon, taken_at, reply_to)
        values (${data.id}, ${context.userId}, ${data.thread.id}, ${data.kind}, ${data.body},
          ${data.thumb || null}, ${data.image || null}, ${data.lat}, ${data.lon}, ${data.takenAt}, ${data.replyTo || null})
        on conflict (id) do nothing
      `;
    }
    // Sending counts as reading what came before.
    await sql`
      insert into message_reads (user_id, thread, read_at) values (${context.userId}, ${readKey(data.thread)}, now())
      on conflict (user_id, thread) do update set read_at = now()
    `;
    return { id: data.id };
  });

export const loadThreadPhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    return { thread: parseThread(row.thread), id: parseMessageId(row.id) };
  })
  .handler(async ({ context, data }) => {
    const sql = await openThread(context.userId, data.thread);
    const rows =
      data.thread.kind === "group"
        ? await sql<{ image: string | null }>`select image from group_messages where id = ${data.id} and group_id = ${data.thread.id}`
        : await sql<{ image: string | null }>`
            select image from messages
            where id = ${data.id} and (from_id = ${context.userId} or to_id = ${context.userId})
          `;
    const image = rows[0]?.image;
    if (!image) throw new Error("That photo isn't in the chat.");
    return { image };
  });

/** Your own message: gone for everyone. Someone else's: hidden for you. */
export const deleteMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    return { thread: parseThread(row.thread), id: parseMessageId(row.id) };
  })
  .handler(async ({ context, data }) => {
    const sql = await openThread(context.userId, data.thread);
    const mine =
      data.thread.kind === "group"
        ? await sql<{ id: string }>`delete from group_messages where id = ${data.id} and from_id = ${context.userId} returning id`
        : await sql<{ id: string }>`delete from messages where id = ${data.id} and from_id = ${context.userId} returning id`;
    if (mine.length) {
      await sql`delete from message_hidden where message_id = ${data.id}`;
      await sql`delete from message_reactions where message_id = ${data.id}`;
      await sql`delete from thread_pins where message_id = ${data.id}`;
      return { removed: "everyone" as const };
    }
    await sql`
      insert into message_hidden (user_id, message_id) values (${context.userId}, ${data.id})
      on conflict do nothing
    `;
    return { removed: "you" as const };
  });

export const toggleReaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const mark = String(row.mark ?? "");
    if (!MARKS.includes(mark as Mark)) throw new Error("Unknown reaction");
    return { thread: parseThread(row.thread), id: parseMessageId(row.id), mark: mark as Mark };
  })
  .handler(async ({ context, data }) => {
    const sql = await openThread(context.userId, data.thread);
    const found =
      data.thread.kind === "group"
        ? await sql<{ id: string }>`select id from group_messages where id = ${data.id} and group_id = ${data.thread.id}`
        : await sql<{ id: string }>`
            select id from messages
            where id = ${data.id}
              and ((from_id = ${context.userId} and to_id = ${data.thread.id}) or (from_id = ${data.thread.id} and to_id = ${context.userId}))
          `;
    if (!found.length) throw new Error("That message is gone.");
    const existing = await sql<{ ok: boolean }>`
      select true as ok from message_reactions
      where message_id = ${data.id} and user_id = ${context.userId} and mark = ${data.mark}
    `;
    if (existing.length) {
      await sql`delete from message_reactions where message_id = ${data.id} and user_id = ${context.userId} and mark = ${data.mark}`;
      return { on: false as const };
    }
    await sql`
      insert into message_reactions (message_id, user_id, mark) values (${data.id}, ${context.userId}, ${data.mark})
      on conflict do nothing
    `;
    return { on: true as const };
  });

/** Stick one message to the top of the chat, or clear it. */
export const setThreadPin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    return { thread: parseThread(row.thread), id: row.id ? parseMessageId(row.id) : "" };
  })
  .handler(async ({ context, data }) => {
    const sql = await openThread(context.userId, data.thread);
    const key = readKey(data.thread);
    if (!data.id) {
      await sql`delete from thread_pins where thread = ${key}`;
      return { pinned: false as const };
    }
    const found =
      data.thread.kind === "group"
        ? await sql<{ id: string }>`select id from group_messages where id = ${data.id} and group_id = ${data.thread.id}`
        : await sql<{ id: string }>`
            select id from messages
            where id = ${data.id}
              and ((from_id = ${context.userId} and to_id = ${data.thread.id}) or (from_id = ${data.thread.id} and to_id = ${context.userId}))
          `;
    if (!found.length) throw new Error("That message is gone.");
    await sql`
      insert into thread_pins (thread, message_id, by_id) values (${key}, ${data.id}, ${context.userId})
      on conflict (thread) do update set message_id = ${data.id}, by_id = ${context.userId}
    `;
    return { pinned: true as const };
  });

export type ChatHit = {
  messageId: string;
  thread: Thread;
  title: string;
  preview: string;
  at: number;
};

/** Find a place name, a caption, or some text across your chats. */
export const searchChats = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = String((input as { q?: unknown } | null)?.q ?? "")
      .trim()
      .slice(0, 40);
    const q = raw.replace(/[\\%_]/g, "");
    if (q.length < 2) throw new Error("Type at least two letters");
    return q;
  })
  .handler(async ({ context, data: q }): Promise<ChatHit[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const me = context.userId;
    const like = `%${q}%`;
    const direct = await sql<{ id: string; other_id: string; kind: string; body: string; created_at: unknown }>`
      select m.id,
        case when m.from_id = ${me} then m.to_id else m.from_id end as other_id,
        m.kind, m.body, m.created_at
      from messages m
      where (m.from_id = ${me} or m.to_id = ${me})
        and m.body ilike ${like}
        and not exists (select 1 from message_hidden h where h.user_id = ${me} and h.message_id = m.id)
      order by m.created_at desc
      limit 20
    `;
    const group = await sql<{ id: string; group_id: string; name: string; kind: string; body: string; created_at: unknown }>`
      select m.id, m.group_id, g.name, m.kind, m.body, m.created_at
      from group_messages m
      join chat_groups g on g.id = m.group_id
      join chat_group_members mem on mem.group_id = m.group_id and mem.user_id = ${me}
      where m.body ilike ${like}
        and not exists (select 1 from message_hidden h where h.user_id = ${me} and h.message_id = m.id)
      order by m.created_at desc
      limit 20
    `;
    const names = await namesFor(sql, [...new Set(direct.map((row) => row.other_id))]);
    return [
      ...direct.map((row) => ({
        messageId: row.id,
        thread: { kind: "friend" as const, id: row.other_id },
        title: names.get(row.other_id) ?? "Friend",
        preview: preview(row.kind, row.body),
        at: toMs(row.created_at),
      })),
      ...group.map((row) => ({
        messageId: row.id,
        thread: { kind: "group" as const, id: row.group_id },
        title: row.name,
        preview: preview(row.kind, row.body),
        at: toMs(row.created_at),
      })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 20);
  });

export type UnreadSummary = {
  friends: Record<string, number>;
  groups: Record<string, number>;
  likes: number;
  /** The newest unread messages, for phone notifications. */
  latest: { id: string; thread: Thread; from: string; preview: string; at: number }[];
};

const preview = (kind: string, body: string) =>
  kind === "trail"
    ? `Shared a trail: ${readTrail(body)?.name ?? ""}`.trim()
    : kind === "trip"
      ? `Shared a trip: ${readTrip(body)?.name ?? ""}`.trim()
      : kind === "photo"
        ? "Sent a photo"
        : kind === "place"
          ? `Shared ${readPlace(body)?.name ?? "a place"}`
          : kind === "link"
            ? "Sent a Google Photos link"
            : body.slice(0, 120);

/** What's new since you last looked: messages per friend and group, and likes. */
export const unreadSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<UnreadSummary> => unreadFor(context.userId));

/**
 * The work behind unreadSummary, also used by /api/notify (where the phone's
 * own background check asks, with its device token instead of the cookie).
 */
export async function unreadFor(me: string): Promise<UnreadSummary> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const direct = await sql<{ id: string; from_id: string; kind: string; body: string; created_at: unknown }>`
    select m.id, m.from_id, m.kind, m.body, m.created_at
    from messages m
    left join message_reads r on r.user_id = ${me} and r.thread = m.from_id
    where m.to_id = ${me}
      and m.created_at > coalesce(r.read_at, to_timestamp(0))
      and exists (select 1 from friendships f where f.user_id = ${me} and f.friend_id = m.from_id)
      and not exists (select 1 from message_hidden h where h.user_id = ${me} and h.message_id = m.id)
    order by m.created_at desc
    limit 200
  `;
  const group = await sql<{ id: string; group_id: string; from_id: string; kind: string; body: string; created_at: unknown }>`
    select m.id, m.group_id, m.from_id, m.kind, m.body, m.created_at
    from group_messages m
    join chat_group_members g on g.group_id = m.group_id and g.user_id = ${me}
    left join message_reads r on r.user_id = ${me} and r.thread = 'g:' || m.group_id
    where m.from_id <> ${me}
      and m.created_at > coalesce(r.read_at, to_timestamp(0))
      and not exists (select 1 from message_hidden h where h.user_id = ${me} and h.message_id = m.id)
    order by m.created_at desc
    limit 200
  `;
  const likes = await sql<{ n: number }>`
    select count(*)::int as n from reactions x
    left join message_reads r on r.user_id = ${me} and r.thread = 'likes'
    where x.owner_id = ${me} and x.created_at > coalesce(r.read_at, to_timestamp(0))
  `;
  const friends: Record<string, number> = {};
  for (const row of direct) friends[row.from_id] = (friends[row.from_id] ?? 0) + 1;
  const groups: Record<string, number> = {};
  for (const row of group) groups[row.group_id] = (groups[row.group_id] ?? 0) + 1;
  const newest = [
    ...direct.map((row) => ({ ...row, thread: { kind: "friend" as const, id: row.from_id } })),
    ...group.map((row) => ({ ...row, thread: { kind: "group" as const, id: row.group_id } })),
  ]
    .sort((a, b) => toMs(b.created_at) - toMs(a.created_at))
    .slice(0, 5);
  const names = await namesFor(sql, [...new Set(newest.map((row) => row.from_id))]);
  return {
    friends,
    groups,
    likes: Number(likes[0]?.n) || 0,
    latest: newest.map((row) => ({
      id: row.id,
      thread: row.thread,
      from: names.get(row.from_id) ?? "A friend",
      preview: preview(row.kind, row.body),
      at: toMs(row.created_at),
    })),
  };
}

export type BoardItem = {
  thread: Thread;
  title: string;
  preview: string;
  at: number;
  /** Profile pictures: the friend's, or up to three people in a trip chat. */
  photos?: string[];
  /** The newest message is yours ("You: …"). */
  mine?: boolean;
  kind?: string;
  members?: number;
};

function goodPhoto(photo: string | null | undefined) {
  const value = photo ?? "";
  return value.startsWith("https://") || value.startsWith("data:image/") ? value : "";
}

/** Every friend and trip chat, newest message first. Chats with nothing yet stay at the bottom. */
export const messageBoard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<BoardItem[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const me = context.userId;
    const friends = await sql<{ id: string; name: string; photo: string }>`
      select f.friend_id as id, coalesce(nullif(p.name, ''), nullif(u.name, ''), 'Friend') as name, coalesce(p.photo, '') as photo
      from friendships f
      left join profiles p on p.user_id = f.friend_id
      left join "user" u on u.id = f.friend_id
      where f.user_id = ${me}
    `;
    const direct = await sql<{ other_id: string; from_id: string; kind: string; body: string; created_at: unknown }>`
      select distinct on (other_id) other_id, from_id, kind, body, created_at
      from (
        select case when from_id = ${me} then to_id else from_id end as other_id, from_id, kind, body, created_at
        from messages m
        where (m.from_id = ${me} or m.to_id = ${me})
          and not exists (select 1 from message_hidden h where h.user_id = ${me} and h.message_id = m.id)
      ) s
      order by other_id, created_at desc
    `;
    const lastDirect = new Map(direct.map((row) => [row.other_id, row]));
    const groups = await sql<{ id: string; name: string }>`
      select g.id, g.name from chat_groups g
      join chat_group_members m on m.group_id = g.id and m.user_id = ${me}
    `;
    const groupLast = groups.length
      ? await sql<{ group_id: string; from_id: string; kind: string; body: string; created_at: unknown }>`
          select distinct on (group_id) group_id, from_id, kind, body, created_at
          from group_messages m
          where m.group_id = any(${groups.map((g) => g.id)}::text[])
            and not exists (select 1 from message_hidden h where h.user_id = ${me} and h.message_id = m.id)
          order by group_id, created_at desc
        `
      : [];
    const lastGroup = new Map(groupLast.map((row) => [row.group_id, row]));
    const memberRows = groups.length
      ? await sql<{ group_id: string; user_id: string; photo: string }>`
          select m.group_id, m.user_id, coalesce(p.photo, '') as photo
          from chat_group_members m left join profiles p on p.user_id = m.user_id
          where m.group_id = any(${groups.map((g) => g.id)}::text[]) and m.user_id <> ${me}
        `
      : [];
    const members = new Map<string, { photos: string[]; count: number }>();
    for (const row of memberRows) {
      const entry = members.get(row.group_id) ?? { photos: [], count: 0 };
      entry.count += 1;
      const photo = goodPhoto(row.photo);
      if (photo && entry.photos.length < 3) entry.photos.push(photo);
      members.set(row.group_id, entry);
    }
    const items: BoardItem[] = [
      ...friends.map((friend) => {
        const last = lastDirect.get(friend.id);
        return {
          thread: { kind: "friend" as const, id: friend.id },
          title: friend.name || "Friend",
          preview: last ? preview(last.kind, last.body) : "No messages yet",
          at: last ? toMs(last.created_at) : 0,
          photos: goodPhoto(friend.photo) ? [goodPhoto(friend.photo)] : [],
          mine: last?.from_id === me,
          kind: last?.kind,
        };
      }),
      ...groups.map((group) => {
        const last = lastGroup.get(group.id);
        return {
          thread: { kind: "group" as const, id: group.id },
          title: group.name,
          preview: last ? preview(last.kind, last.body) : "No messages yet",
          at: last ? toMs(last.created_at) : 0,
          photos: members.get(group.id)?.photos ?? [],
          members: (members.get(group.id)?.count ?? 0) + 1,
          mine: last?.from_id === me,
          kind: last?.kind,
        };
      }),
    ];
    items.sort((a, b) => b.at - a.at || a.title.localeCompare(b.title));
    return items;
  });

// ---------------------------------------------------------------- older app builds
// Phones that haven't updated yet still call these.

export const listMessages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseThread({ kind: "friend", id: (input as { id?: unknown } | null)?.id }))
  .handler(async ({ context, data: thread }) => {
    const sql = await openThread(context.userId, thread);
    const rows = (await listRows(sql, context.userId, thread)).reverse().filter((row) => row.kind !== "place");
    return rows.map((row) => ({
      id: row.id,
      fromId: row.from_id,
      kind: (row.kind === "link" || row.kind === "photo" ? row.kind : "text") as "text" | "link" | "photo",
      body: row.body || "",
      thumb: row.thumb || "",
      at: toMs(row.created_at),
    }));
  });

export const sendMessage = sendToThread;

export const loadMessagePhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseMessageId((input as { id?: unknown } | null)?.id))
  .handler(async ({ context, data: id }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ image: string | null }>`
      select image from messages
      where id = ${id} and (from_id = ${context.userId} or to_id = ${context.userId})
    `;
    const image = rows[0]?.image;
    if (!image) throw new Error("That photo isn't in the chat.");
    return { image };
  });
