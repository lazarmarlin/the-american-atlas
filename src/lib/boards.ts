/**
 * Boards: a to-do, a packing list, or a trip plan. The person who makes one
 * can send it in a chat. A friend can check things off, or change the list,
 * if they were allowed to. src/components/boards-page.tsx.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Thread } from "@/lib/messages";

export type BoardKind =
  | "todo"
  | "pack"
  | "trip"
  | "wish"
  | "car"
  | "split"
  | "meals"
  | "check"
  | "postcards"
  | "budget"
  | "fuel"
  | "journal"
  | "bestof"
  | "plates"
  | "bingo"
  | "alpha"
  | "cows"
  | "chains"
  | "guess"
  | "county"
  | "trivia";
export const ALL_KINDS: BoardKind[] = ["todo", "pack", "trip", "wish", "car", "split", "meals", "check", "postcards", "budget", "fuel", "journal", "bestof", "plates", "bingo", "alpha", "cows", "chains", "guess", "county", "trivia"];
export type BoardCategory = "plan" | "money" | "car" | "play" | "memories";
/** Small extra facts on an item or a board (a game's score, a fill-up's gallons). */
export type BoardMeta = Record<string, string | number | boolean | null>;
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
  /** Car care: which car it's for (none: the first one). */
  carId?: string | null;
  /** Split costs: cents, who paid, who it was for (empty: everyone). A payment settles up between two people. */
  amount?: number | null;
  paidBy?: string | null;
  among?: string[];
  payment?: boolean;
  /** Who did it (a game's spotter, a journal line's writer), and when (ms). */
  by?: string | null;
  at?: number | null;
  meta?: BoardMeta;
};
export type BoardDoc = {
  start: string | null;
  end: string | null;
  items: BoardItem[];
  /** Car care: the cars, each with an odometer reading and who drives it when. */
  cars?: BoardCar[];
  /** Board-wide settings (a budget's amount, a game's round). */
  extra?: BoardMeta;
};

/**
 * A car on a car-care board. Miles tracking logs count toward it on the days
 * someone said "I'm driving this one" (drivers), from its odometer reading on.
 */
export type BoardCar = {
  id: string;
  name: string;
  odometer: number | null;
  at: string | null;
  drivers: { user: string; from: string; to: string | null }[];
};
export type BoardCard = { id: string; title: string; kind: BoardKind };
export type BoardPerson = { id: string; name: string };
export type BoardInfo = BoardCard & {
  /** A line for the list (a budget's money left, a game's score). */
  summary?: string | null;
  role: BoardRole;
  updatedAt: number;
  done: number;
  total: number;
  start: string | null;
  end: string | null;
  /** Car care: how many are due or nearly due, and how many cars. Split: the total spent, in cents. */
  due?: number;
  cars?: number;
  spent?: number;
};
export type BoardOpen = BoardCard & {
  role: BoardRole;
  doc: BoardDoc;
  updatedAt: number;
  /** Everyone on the board (the owner first). */
  people?: BoardPerson[];
  /** Car care: miles tracked since each car's odometer reading, by car id. */
  carMiles?: Record<string, number>;
  /** Who's looking (to say "You"). */
  me?: string;
  /** Fuel log: miles driven before each fill-up (from the odometer, or tracking), by item id. */
  fuelMiles?: Record<string, number>;
};

export const BOARD_CATEGORIES: { id: BoardCategory; name: string }[] = [
  { id: "plan", name: "Plan" },
  { id: "money", name: "Money" },
  { id: "car", name: "Car" },
  { id: "play", name: "Play" },
  { id: "memories", name: "Memories" },
];

/** Every kind of board, with the categories it shows under (the fuel log is both Money and Car). */
export const BOARD_KINDS: { id: BoardKind; name: string; line: string; cats: BoardCategory[] }[] = [
  { id: "trip", name: "Trip plan", line: "The stops, and the days, for whoever's coming.", cats: ["plan"] },
  { id: "pack", name: "Packing list", line: "What to bring. Check it off as it goes in the bag.", cats: ["plan"] },
  { id: "todo", name: "To-do", line: "Things to get done. A friend can check them off.", cats: ["plan"] },
  { id: "wish", name: "Wish list", line: "Places to get to. Ticks itself off when you do.", cats: ["plan"] },
  { id: "meals", name: "Camp meals", line: "Meals and groceries, so nobody forgets the coffee.", cats: ["plan"] },
  { id: "split", name: "Split costs", line: "Who paid for what, and who owes whom.", cats: ["money"] },
  { id: "budget", name: "Trip budget", line: "Set an amount, see what's left for each day.", cats: ["money"] },
  { id: "fuel", name: "Fuel log", line: "Fill-ups, what they cost, and miles per gallon.", cats: ["money", "car"] },
  { id: "car", name: "Car care", line: "Oil, tires, and the rest, due by the miles you drive.", cats: ["car"] },
  { id: "check", name: "Pre-trip check", line: "Tires, fluids, lights: run through it before you go.", cats: ["car"] },
  { id: "plates", name: "License plates", line: "Spot a plate from every state. The map fills in.", cats: ["play"] },
  { id: "bingo", name: "Road trip bingo", line: "Everyone gets their own card. First to five wins.", cats: ["play"] },
  { id: "alpha", name: "Alphabet race", line: "A to Z from the signs, in order. Who gets to Z?", cats: ["play"] },
  { id: "cows", name: "Cow count", line: "Count the cows on your side. A cemetery takes them all.", cats: ["play"] },
  { id: "chains", name: "Chain spotting", line: "The regional chains, ticked off as you pass them.", cats: ["play"] },
  { id: "guess", name: "State line guess", line: "Guess the minutes to the next state. Closest wins.", cats: ["play"] },
  { id: "county", name: "Name that county", line: "Drive mode asks before each county line.", cats: ["play"] },
  { id: "trivia", name: "State trivia", line: "A question about each state as you cross into it.", cats: ["play"] },
  { id: "journal", name: "Trip journal", line: "A line a day, with where you went.", cats: ["memories"] },
  { id: "bestof", name: "Best of the trip", line: "Best meal, best view, worst motel. Everyone picks.", cats: ["memories"] },
  { id: "postcards", name: "Postcards", line: "Who to send one to, and who's had theirs.", cats: ["memories"] },
];

const BOARD_RE = /^bd-[a-z0-9]{8,24}$/;
const ITEM_RE = /^bi-[a-z0-9]{6,16}$/;
const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GROUP_RE = /^cg-[a-z0-9]{6,24}$/;

const NAMES = Object.fromEntries(BOARD_KINDS.map((kind) => [kind.id, kind.name])) as Record<BoardKind, string>;
const META_KEY = /^[a-zA-Z]{1,16}$/;

/** Small facts: up to 16 short keys with short values. */
function cleanMeta(value: unknown): BoardMeta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: BoardMeta = {};
  let n = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (n >= 16 || !META_KEY.test(key)) continue;
    if (raw === null || typeof raw === "boolean") out[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) < 1e13) out[key] = raw;
    else if (typeof raw === "string") out[key] = raw.slice(0, 200);
    else continue;
    n += 1;
  }
  return n ? out : undefined;
}
const PLACE_RE = /^[\w:._ -]{1,140}$/;
const CAR_RE = /^car-[a-z0-9]{1,16}$/;

type Sql = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;

/** Games and shared memories: everyone on the board adds their own moves, even if they may only check things off. */
export const PLAYER_KINDS = new Set<BoardKind>(["plates", "bingo", "alpha", "cows", "chains", "guess", "county", "trivia", "journal", "bestof"]);

/** A short, stable tag for a person (part of their game rows' ids). */
export function userTag(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(6, "0").slice(-6);
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** One line for the boards list. */
export function boardSummary(kind: BoardKind, doc: BoardDoc): string | null {
  const items = doc.items;
  const players = new Set(items.map((item) => item.by).filter(Boolean)).size;
  switch (kind) {
    case "budget": {
      const budget = Number(doc.extra?.budget) || 0;
      const spent = items.reduce((sum, item) => sum + (item.amount ?? 0), 0);
      return budget ? `${dollars(Math.max(0, budget - spent))} left of ${dollars(budget)}` : `${dollars(spent)} spent`;
    }
    case "fuel": {
      const spent = items.reduce((sum, item) => sum + (item.amount ?? 0), 0);
      return items.length ? `${items.length} ${items.length === 1 ? "fill-up" : "fill-ups"} · ${dollars(spent)}` : "No fill-ups yet";
    }
    case "journal":
      return items.length ? `${items.length} ${items.length === 1 ? "entry" : "entries"}` : "Nothing written yet";
    case "bestof": {
      const cats = items.filter((item) => item.meta?.cat === true).length;
      return `${cats} ${cats === 1 ? "category" : "categories"} · ${items.length - cats} picks`;
    }
    case "plates": {
      const states = new Set(items.filter((item) => item.meta?.plate && item.meta?.ca !== true).map((item) => item.meta?.plate));
      return `${states.size} of 51 states`;
    }
    case "bingo":
      return items.some((item) => item.meta?.bingo) ? "Somebody has bingo!" : `${players || 0} ${players === 1 ? "player" : "players"}`;
    case "alpha": {
      const far = items.reduce((max, item) => Math.max(max, Number(item.meta?.n) || 0), 0);
      return far ? `Furthest: ${String.fromCharCode(64 + far)}` : "Nobody's started";
    }
    case "cows": {
      const total = items.reduce((sum, item) => sum + (Number(item.meta?.cows) || 0), 0);
      return `${total.toLocaleString()} cows`;
    }
    case "chains":
      return `${items.filter((item) => item.done).length} of ${items.length} spotted`;
    case "guess":
      return doc.extra?.roundAt && doc.extra?.result == null ? "A round is on" : "No round on";
    case "county":
    case "trivia": {
      const right = items.reduce((sum, item) => sum + (Number(item.meta?.right) || 0), 0);
      const asked = items.reduce((sum, item) => sum + (Number(item.meta?.asked) || 0), 0);
      return asked ? `${right} of ${asked} right` : "No questions yet";
    }
    default:
      return null;
  }
}

export function kindOf(value: unknown): BoardKind {
  return ALL_KINDS.includes(value as BoardKind) ? (value as BoardKind) : "todo";
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

/** Games keep a row per player per square (bingo, the alphabet), so they get more room. */
const MAX_ITEMS = 400;

export function emptyDoc(): BoardDoc {
  return { start: null, end: null, items: [] };
}

export function cleanDoc(value: unknown): BoardDoc {
  const row = (value ?? {}) as Record<string, unknown>;
  const items: BoardItem[] = [];
  for (const item of Array.isArray(row.items) ? row.items.slice(0, MAX_ITEMS) : []) {
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
    if (CAR_RE.test(String(raw.carId ?? ""))) out.carId = String(raw.carId);
    if (USER_RE.test(String(raw.by ?? ""))) out.by = String(raw.by);
    if (Number.isFinite(Number(raw.at)) && Number(raw.at) > 0) out.at = Math.round(Number(raw.at));
    const meta = cleanMeta(raw.meta);
    if (meta) out.meta = meta;
    items.push(out);
  }
  const cars: BoardCar[] = [];
  for (const raw of Array.isArray(row.cars) ? row.cars.slice(0, 8) : []) {
    const car = (raw ?? {}) as Record<string, unknown>;
    const id = String(car.id ?? "");
    if (!CAR_RE.test(id) || cars.some((c) => c.id === id)) continue;
    const drivers = (Array.isArray(car.drivers) ? car.drivers.slice(-60) : []).flatMap((entry) => {
      const d = (entry ?? {}) as Record<string, unknown>;
      const user = String(d.user ?? "");
      const from = day(d.from);
      return USER_RE.test(user) && from ? [{ user, from, to: day(d.to) }] : [];
    });
    cars.push({ id, name: String(car.name ?? "").trim().slice(0, 40), odometer: whole(car.odometer, 3000000), at: day(car.at), drivers });
  }
  // Boards from before there could be more than one car.
  const legacy = row.car as Record<string, unknown> | null | undefined;
  if (!cars.length && legacy && whole(legacy.odometer, 3000000) != null && day(legacy.at)) {
    cars.push({ id: "car-1", name: "", odometer: whole(legacy.odometer, 3000000), at: day(legacy.at), drivers: [] });
  }
  const extra = cleanMeta(row.extra);
  return { start: day(row.start), end: day(row.end), items, ...(cars.length ? { cars } : {}), ...(extra ? { extra } : {}) };
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
  const cars = same(mine.cars, base.cars) ? theirs.cars : mine.cars;
  // Board settings key by key: mine where I changed one, theirs otherwise.
  const extra: BoardMeta = { ...(theirs.extra ?? {}) };
  for (const key of new Set([...Object.keys(mine.extra ?? {}), ...Object.keys(base.extra ?? {})])) {
    const now = mine.extra?.[key];
    if (!same(now, base.extra?.[key])) {
      if (now === undefined) delete extra[key];
      else extra[key] = now;
    }
  }
  return {
    start: mine.start !== base.start ? mine.start : theirs.start,
    end: mine.end !== base.end ? mine.end : theirs.end,
    items: items.slice(0, MAX_ITEMS),
    ...(cars?.length ? { cars } : {}),
    ...(Object.keys(extra).length ? { extra } : {}),
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

/**
 * Car care: miles tracked since each car's odometer reading. A car counts
 * the days someone said they were driving it. Until anyone has said so, the
 * first car gets all of the owner's tracked miles (one car, nothing to pick).
 */
async function carMiles(sql: Sql, ownerId: string, doc: BoardDoc): Promise<Record<string, number>> {
  const cars = doc.cars ?? [];
  const out: Record<string, number> = {};
  const picked = cars.some((car) => car.drivers.length);
  for (const [index, car] of cars.entries()) {
    out[car.id] = 0;
    if (!car.at || car.odometer == null) continue;
    if (!picked) {
      if (index !== 0) continue;
      const rows = await sql<{ miles: number | null }>`
        select coalesce(sum(miles), 0)::float as miles from drive_days where user_id = ${ownerId} and day > ${car.at}::date
      `;
      out[car.id] = Math.round(Number(rows[0]?.miles) || 0);
      continue;
    }
    let miles = 0;
    for (const spell of car.drivers) {
      // Days after the reading, within this spell of driving it.
      const from = spell.from > car.at ? spell.from : nextDay(car.at);
      if (spell.to && spell.to < from) continue;
      const rows = spell.to
        ? await sql<{ miles: number | null }>`
            select coalesce(sum(miles), 0)::float as miles from drive_days where user_id = ${spell.user} and day >= ${from}::date and day <= ${spell.to}::date
          `
        : await sql<{ miles: number | null }>`
            select coalesce(sum(miles), 0)::float as miles from drive_days where user_id = ${spell.user} and day >= ${from}::date
          `;
      miles += Number(rows[0]?.miles) || 0;
    }
    out[car.id] = Math.round(miles);
  }
  return out;
}

/**
 * "I'm driving this one": my spell in any other car on the board ends
 * yesterday (or is dropped if it only started today), and one starts today
 * in this car.
 */
export function withDriver(doc: BoardDoc, carId: string, me: string, today: string, owner?: string): BoardDoc {
  const yesterday = prevDay(today);
  let start = doc.cars ?? [];
  // Until now the first car got all of the owner's miles: keep those counted for it.
  if (owner && start[0]?.at && !start.some((car) => car.drivers.length)) {
    start = start.map((car, i) => (i === 0 ? { ...car, drivers: [{ user: owner, from: nextDay(car.at as string), to: null }] } : car));
  }
  const cars = start.map((car) => {
    const drivers = car.drivers.flatMap((spell) => {
      if (spell.user !== me || spell.to) return [spell];
      if (car.id === carId) return [spell];
      return spell.from >= today ? [] : [{ ...spell, to: yesterday }];
    });
    if (car.id === carId && !drivers.some((spell) => spell.user === me && !spell.to)) drivers.push({ user: me, from: today, to: null });
    return { ...car, drivers };
  });
  return { ...doc, cars };
}

/** The car someone is driving now on this board, if they've said. */
export function drivingCar(doc: BoardDoc, me: string) {
  return (doc.cars ?? []).find((car) => car.drivers.some((spell) => spell.user === me && !spell.to)) ?? null;
}

function prevDay(value: string) {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function nextDay(value: string) {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The car a job is for (a job without one belongs to the first car). */
export function jobCar(doc: BoardDoc, item: BoardItem) {
  const cars = doc.cars ?? [];
  return cars.find((car) => car.id === item.carId) ?? cars[0] ?? null;
}

/** A car's odometer now: the reading plus the miles tracked for it since. */
export function carOdometer(car: BoardCar | null, miles: Record<string, number> | undefined) {
  return car && car.odometer != null ? car.odometer + (miles?.[car.id] ?? 0) : null;
}

/** How many car jobs are due within 300 miles or 3 weeks. */
export function carDue(doc: BoardDoc, miles: Record<string, number>, now = Date.now()) {
  return doc.items.filter((item) => {
    const odometer = carOdometer(jobCar(doc, item), miles);
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

/**
 * A player who may only check things off still plays: their own rows (by =
 * them) are added, changed or taken back, and checks on anything are kept.
 * Nobody else's rows change.
 */
function playerMoves(current: BoardDoc, mine: BoardDoc, base: BoardDoc, me: string, kind?: BoardKind): BoardDoc {
  const mineById = new Map(mine.items.map((item) => [item.id, item]));
  const baseMine = new Set(base.items.filter((item) => item.by === me).map((item) => item.id));
  const items: BoardItem[] = [];
  for (const item of current.items) {
    const next = mineById.get(item.id);
    if (item.by === me) {
      if (next && next.by === me) items.push(next);
      else if (!next && baseMine.has(item.id)) continue;
      else items.push(item);
    } else items.push(next ? { ...item, done: next.done } : item);
  }
  const have = new Set(current.items.map((item) => item.id));
  for (const item of mine.items) if (item.by === me && !have.has(item.id) && !baseMine.has(item.id)) items.push(item);
  // Anyone playing the state line guess can start the next round.
  let extra = current.extra;
  if (kind === "guess") {
    const roundNow = Number(mine.extra?.roundAt) || 0;
    if (roundNow && roundNow !== (Number(base.extra?.roundAt) || 0) && roundNow > (Number(current.extra?.roundAt) || 0) && roundNow <= Date.now() + 60000) {
      extra = { ...(current.extra ?? {}), roundAt: roundNow, from: String(mine.extra?.from ?? "").slice(0, 2), result: null, to: null };
    }
  }
  return { ...current, items: items.slice(0, MAX_ITEMS), ...(extra ? { extra } : {}) };
}

/**
 * Chain spotting: a chain is spotted when anyone on the board has one on
 * their map, added since the board was made (so last year's doesn't count).
 */
async function tickChains(sql: Sql, boardId: string, ownerId: string, doc: BoardDoc): Promise<{ doc: BoardDoc; ticked: string[] }> {
  const open = doc.items.filter((item) => !item.done);
  if (!open.length) return { doc, ticked: [] };
  const members = await memberIds(sql, boardId, ownerId);
  const made = await sql<{ created_at: unknown }>`select created_at from boards where id = ${boardId}`;
  const since = made[0]?.created_at instanceof Date ? (made[0].created_at as Date).toISOString() : String(made[0]?.created_at ?? "1970-01-01");
  const rows = await sql<{ name: string; user_id: string; created_at: unknown }>`
    select name, user_id, created_at from marks
    where user_id = any(${members}::text[]) and created_at >= ${since}::timestamptz
    order by created_at
    limit 4000
  `;
  if (!rows.length) return { doc, ticked: [] };
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ticked: string[] = [];
  const items = doc.items.map((item) => {
    if (item.done) return item;
    const want = norm(String(item.meta?.match ?? item.text));
    const hit = rows.find((row) => norm(row.name).startsWith(want));
    if (!hit) return item;
    ticked.push(item.text);
    const at = new Date(String(hit.created_at)).getTime();
    return { ...item, done: true, by: hit.user_id, at: Number.isFinite(at) ? at : Date.now() };
  });
  if (!ticked.length) return { doc, ticked };
  const next = { ...doc, items };
  await sql`update boards set doc = ${JSON.stringify(next)}::jsonb, updated_at = now() where id = ${boardId}`;
  return { doc: next, ticked };
}

/**
 * Fuel log: miles driven since the fill-up before. From the odometer when
 * both have one; otherwise what the filler's phone tracked on the days
 * between (the fill-up day itself counts toward the later one).
 */
async function fuelMiles(sql: Sql, ownerId: string, doc: BoardDoc): Promise<Record<string, number>> {
  const fills = doc.items
    .filter((item) => day(item.meta?.day))
    .sort((a, b) => String(a.meta?.day).localeCompare(String(b.meta?.day)) || (a.at ?? 0) - (b.at ?? 0));
  const out: Record<string, number> = {};
  for (let i = 1; i < fills.length; i++) {
    const prev = fills[i - 1];
    const fill = fills[i];
    const odoNow = Number(fill.meta?.odo);
    const odoBefore = Number(prev.meta?.odo);
    if (odoNow > 0 && odoBefore > 0 && odoNow > odoBefore) {
      out[fill.id] = odoNow - odoBefore;
      continue;
    }
    const who = fill.by ?? ownerId;
    const rows = await sql<{ miles: number | null }>`
      select coalesce(sum(miles), 0)::float as miles from drive_days
      where user_id = ${who} and day >= ${String(prev.meta?.day)}::date and day < ${String(fill.meta?.day)}::date
    `;
    const miles = Math.round(Number(rows[0]?.miles) || 0);
    if (miles > 0) out[fill.id] = miles;
  }
  return out;
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
  if (kind === "wish" || kind === "chains") {
    const ticked = kind === "wish" ? await tickWish(sql, id, board.owner_id, doc) : await tickChains(sql, id, board.owner_id, doc);
    if (ticked.ticked.length) at = Date.now();
    next = ticked.doc;
  }
  const out: BoardOpen = { id, title: board.title, kind, role, doc: next, updatedAt: at, me };
  out.people = await boardPeople(sql, id, board.owner_id);
  if (kind === "car") out.carMiles = await carMiles(sql, board.owner_id, next);
  if (kind === "fuel") out.fuelMiles = await fuelMiles(sql, board.owner_id, next);
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
    const rows = await sql<{ id: string; owner_id: string; title: string; doc: unknown; kind: string }>`
      select b.id, b.owner_id, b.title, b.doc, b.kind from boards b
      where b.kind in ('wish', 'chains') and (b.owner_id = ${context.userId} or exists (select 1 from board_shares s where s.board_id = b.id and s.user_id = ${context.userId}))
      limit 40
    `;
    const ticked: { board: string; place: string }[] = [];
    for (const row of rows) {
      const doc = readDoc(row.doc);
      const result = row.kind === "chains" ? await tickChains(sql, row.id, row.owner_id, doc) : await tickWish(sql, row.id, row.owner_id, doc);
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
      if (kind === "chains") doc = (await tickChains(sql, row.id, row.owner_id, doc)).doc;
      if (kind === "car") extra = { due: carDue(doc, await carMiles(sql, row.owner_id, doc)), cars: doc.cars?.length ?? 0 };
      if (kind === "split") extra = { spent: spentOf(doc) };
      extra = { ...extra, summary: boardSummary(kind, doc) };
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
    const kind = kindOf(board.kind);
    const doc =
      role === "check" && PLAYER_KINDS.has(kind)
        ? playerMoves(current, data.doc, data.base ?? current, context.userId, kind)
        : role === "check"
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

export type MyCar = { boardId: string; carId: string; name: string; driving: boolean };

/** Every car on the car-care boards you can change, and which one you're driving (Drive mode). */
export const myCars = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MyCar[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ id: string; title: string; doc: unknown }>`
      select b.id, b.title, b.doc from boards b
      where b.kind = 'car' and (b.owner_id = ${context.userId} or exists (select 1 from board_shares s where s.board_id = b.id and s.user_id = ${context.userId} and s.role = 'edit'))
      order by b.updated_at desc
      limit 20
    `;
    const out: MyCar[] = [];
    for (const row of rows) {
      const doc = readDoc(row.doc);
      for (const car of doc.cars ?? []) {
        out.push({ boardId: row.id, carId: car.id, name: car.name || row.title, driving: car.drivers.some((spell) => spell.user === context.userId && !spell.to) });
      }
    }
    return out;
  });

/** Say which car you're in now: its miles count from today. Leaves every other car of yours. */
export const driveCar = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const boardId = String(row.boardId ?? "");
    const carId = String(row.carId ?? "");
    const today = day(row.today);
    if (!BOARD_RE.test(boardId) || !CAR_RE.test(carId) || !today) throw new Error("Unknown car");
    return { boardId, carId, today };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const { role } = await loadAccess(sql, context.userId, data.boardId);
    if (role === "check") throw new Error("You can't change that board.");
    // Out of whatever car you were in on your other boards.
    const rows = await sql<{ id: string; doc: unknown; owner_id: string }>`
      select b.id, b.doc, b.owner_id from boards b
      where b.kind = 'car' and (b.owner_id = ${context.userId} or exists (select 1 from board_shares s where s.board_id = b.id and s.user_id = ${context.userId} and s.role = 'edit'))
    `;
    for (const row of rows) {
      const doc = readDoc(row.doc);
      const next =
        row.id === data.boardId ? withDriver(doc, data.carId, context.userId, data.today, row.owner_id) : withDriver(doc, "car-none", context.userId, data.today);
      if (JSON.stringify(next) !== JSON.stringify(doc)) await sql`update boards set doc = ${JSON.stringify(next)}::jsonb, updated_at = now() where id = ${row.id}`;
    }
    return { ok: true };
  });

/** Boards you can play on (owner, or shared with you), newest first. */
async function playable(sql: Sql, me: string, kinds: BoardKind[]) {
  return sql<{ id: string; owner_id: string; title: string; kind: string; doc: unknown }>`
    select b.id, b.owner_id, b.title, b.kind, b.doc from boards b
    where b.kind = any(${kinds}::text[]) and (b.owner_id = ${me} or exists (select 1 from board_shares s where s.board_id = b.id and s.user_id = ${me}))
    order by b.updated_at desc
    limit 20
  `;
}

export type MyGames = {
  county: { id: string; title: string } | null;
  trivia: { id: string; title: string } | null;
  /** State line guess boards with a round on, and the state the round started in. */
  guess: { id: string; title: string; roundAt: number; from: string }[];
};

/** The games Drive mode helps with: quizzes to ask, and state-line rounds to settle. */
export const myGames = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MyGames> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await playable(sql, context.userId, ["county", "trivia", "guess"]);
    const first = (kind: string) => {
      const row = rows.find((r) => r.kind === kind);
      return row ? { id: row.id, title: row.title } : null;
    };
    const guess = rows
      .filter((row) => row.kind === "guess")
      .flatMap((row) => {
        const doc = readDoc(row.doc);
        const roundAt = Number(doc.extra?.roundAt) || 0;
        return roundAt && doc.extra?.result == null ? [{ id: row.id, title: row.title, roundAt, from: String(doc.extra?.from ?? "") }] : [];
      });
    return { county: first("county"), trivia: first("trivia"), guess };
  });

/** A quiz answer from Drive mode: your tally on that game's board goes up. */
export const addGameResult = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const kind = row.kind === "trivia" ? ("trivia" as const) : ("county" as const);
    return { kind, right: Boolean(row.right), q: String(row.q ?? "").slice(0, 120) };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await playable(sql, context.userId, [data.kind]);
    const row = rows[0];
    if (!row) return { ok: false, right: 0, asked: 0 };
    const doc = readDoc(row.doc);
    const id = `bi-sc${userTag(context.userId)}`;
    const mine = doc.items.find((item) => item.id === id);
    const right = (Number(mine?.meta?.right) || 0) + (data.right ? 1 : 0);
    const asked = (Number(mine?.meta?.asked) || 0) + 1;
    const streak = data.right ? (Number(mine?.meta?.streak) || 0) + 1 : 0;
    const best = Math.max(Number(mine?.meta?.best) || 0, streak);
    const item: BoardItem = { id, text: "score", note: "", done: false, by: context.userId, at: Date.now(), meta: { right, asked, streak, best, last: data.q, lastRight: data.right } };
    const items = mine ? doc.items.map((it) => (it.id === id ? item : it)) : [...doc.items, item];
    await sql`update boards set doc = ${JSON.stringify({ ...doc, items })}::jsonb, updated_at = now() where id = ${row.id}`;
    return { ok: true, right, asked };
  });

/** You crossed into another state: settle any state-line rounds that were on. */
export const settleStateLine = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const state = String(row.state ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) throw new Error("Unknown state");
    return { state };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await playable(sql, context.userId, ["guess"]);
    const settled: string[] = [];
    for (const row of rows) {
      const doc = readDoc(row.doc);
      const roundAt = Number(doc.extra?.roundAt) || 0;
      if (!roundAt || doc.extra?.result != null || doc.extra?.from === data.state) continue;
      const minutes = Math.max(0, Math.round((Date.now() - roundAt) / 60000));
      const extra = { ...(doc.extra ?? {}), result: minutes, crossedAt: Date.now(), to: data.state };
      // The closest guess this round wins it.
      const guesses = doc.items.filter((item) => item.meta?.round === roundAt && typeof item.meta?.min === "number");
      guesses.sort((a, b) => Math.abs(Number(a.meta?.min) - minutes) - Math.abs(Number(b.meta?.min) - minutes) || (a.at ?? 0) - (b.at ?? 0));
      const winner = guesses[0]?.id;
      const items = doc.items.map((item) => (item.id === winner ? { ...item, meta: { ...(item.meta ?? {}), won: true } } : item));
      await sql`update boards set doc = ${JSON.stringify({ ...doc, items, extra })}::jsonb, updated_at = now() where id = ${row.id}`;
      settled.push(row.title);
    }
    return { settled };
  });
