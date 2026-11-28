/**
 * City squares, the game: a city cut into squares (src/lib/city-grid.ts),
 * filled in by visiting them with tracking on. A board of kind "squares"
 * holds the sharing (src/lib/boards.ts); the game itself is square_games (the
 * city, size, mode and grid) and square_visits (who visited which square,
 * when). Only trips after the game starts count.
 *
 * Together: one card, everyone's squares fill it. Race: a square is whoever
 * got there first; most squares wins. Skips (squares nobody can get into)
 * only in Together, about one per 50 squares for the whole card.
 *
 * With modifier cards on (src/lib/square-cards.ts), now and then a new square
 * deals you a card, and until you've done what it says, squares you pass
 * through don't count (for you).
 *
 * Any player can pause the game (one of you has to leave) and any player can
 * carry on. While it's paused tracking adds nobody's squares: the server
 * turns away squares from any paused stretch, even ones a phone sends later.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { CARD_EVERY, CARD_REACH_MILES, CARD_SWAPS, DECK_MAX, SQUARE_CARDS, cardById, drawCard, type DealContext, type Deck, type GridRule, type SquareCard } from "@/lib/square-cards";
import {
  MAX_SQUARES,
  SQUARE_SIZES,
  type TravelMode,
  cornerSquares,
  edgeSquares,
  farSquare,
  holeSquares,
  inGrid,
  latOf,
  lonOf,
  maskFromText,
  middleSquare,
  packSquares,
  skipsFor,
  squareAt,
  squareCenter,
  straightRun,
  todaysSquares,
  touching,
  unpackSquares,
  type Grid,
} from "@/lib/city-grid";
import { isDark } from "@/lib/sun";

export type SquaresMode = "together" | "race";
/** What's cut into squares: a city or town, a state park, or a national park. */
export type SquaresPlace = "city" | "county" | "state" | "national";

export type SquaresGame = {
  /** The place's name (a city, or a park). */
  city: string;
  place: SquaresPlace;
  /** On foot, bike or car: squares only count at that speed or slower. */
  travel: TravelMode;
  /** Modifier cards on. */
  cards: boolean;
  /** Hard mode: stay a moment in a square, new squares have to touch yours, small pockets, harder cards later on. */
  hard: boolean;
  state: string;
  geoid: string;
  zoom: number;
  mode: SquaresMode;
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** The city's squares in the box, as a base64 bit mask. */
  mask: string;
  total: number;
  startedAt: number;
};

export type SquaresState = {
  game: SquaresGame | null;
  me: string;
  owner: boolean;
  players: { id: string; name: string }[];
  /** Each player's squares: the ones they got to first (packed, see packSquares). */
  firsts: Record<string, string>;
  /** How many squares each player has visited in all (in Together, also ones a friend got to first). */
  visits: Record<string, number>;
  /** Skipped squares (Together), packed, and how many skips the card has. */
  skips: string;
  skipsAllowed: number;
  /** Paused now: who paused it and since when (ms). */
  paused: { by: string; since: number } | null;
  /** Cards players are holding now (not done yet), by player. Yours carries where you can go to do it. */
  holding: Record<string, { card: string; since: number; targets?: [string, string, number, number][]; grid?: HeldGrid }>;
  /** Cards you've played (done), newest first. */
  played: { card: string; at: number }[];
  swapsLeft: number;
  /** Today's squares (count double), and how many of them each player got today. */
  today: number[];
  bonus: Record<string, number>;
};

/** A grid card being held: what it asks for, and its squares (the corner, the far side, the holes…). */
export type HeldGrid = { rule: GridRule; squares: number[] };

/* ------------------------------------------------------------------ cards */

/** A deck from the phone: "go to" cards only, each a list of [id, name, lat, lon], capped. */
function parseDeck(value: unknown): Deck | null {
  if (!value || typeof value !== "object") return null;
  const out: Deck = {};
  for (const card of SQUARE_CARDS) {
    if (!card.cats) continue;
    const list = (value as Record<string, unknown>)[card.id];
    if (!Array.isArray(list)) continue;
    out[card.id] = list
      .slice(0, DECK_MAX)
      .filter((p): p is [string, string, number, number] => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string" && Number.isFinite(p[2]) && Number.isFinite(p[3]))
      .map(([id, name, lat, lon]) => [id.slice(0, 140), name.slice(0, 160), Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
  }
  return out;
}

async function deckOf(sql: Sql, board: string): Promise<Deck | null> {
  try {
    const rows = await sql<{ deck: unknown; spots: unknown }>`select deck, spots from square_games where board_id = ${board}`;
    const raw = rows[0]?.deck;
    const deck = parseDeck(typeof raw === "string" ? JSON.parse(raw) : raw);
    // The everyday places (OpenStreetMap) do the everyday-place cards.
    const spots = readSpots(rows[0]?.spots);
    if (!spots.length) return deck;
    const out: Deck = { ...(deck ?? {}) };
    for (const card of SQUARE_CARDS) if (card.osm) out[card.id] = spots.filter((spot) => spot[1] === card.osm).map(([id, , name, lat, lon]) => [id, name, lat, lon]);
    return out;
  } catch {
    return null;
  }
}

/** [osm id, kind, name, lat, lon] */
export type GameSpot = [string, string, string, number, number];

function readSpots(raw: unknown): GameSpot[] {
  const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is GameSpot => Array.isArray(p) && p.length === 5 && typeof p[0] === "string" && Number.isFinite(p[3]) && Number.isFinite(p[4]));
}

/** Everyone's visits in a game: square, who, when (ms). */
async function visitsOf(sql: Sql, board: string) {
  const rows = await sql<{ square: number; user_id: string; at: number }>`
    select square, user_id, (extract(epoch from at) * 1000)::float8 as at from square_visits where board_id = ${board} and how = 'visit' order by at
  `;
  return rows.map((row) => ({ square: Number(row.square), user: row.user_id, at: Number(row.at) }));
}

/** A card's places you can still use in this game (each place does one card per game). */
async function targetsFor(sql: Sql, board: string, me: string, card: string, deck: Deck | null) {
  const list = deck?.[card] ?? [];
  if (!list.length) return [];
  const used = await sql<{ place: string }>`select place from square_cards where board_id = ${board} and user_id = ${me} and place is not null`;
  const gone = new Set(used.map((row) => row.place));
  return list.filter(([id]) => !gone.has(id));
}

/** What a card is measured by, now: visits to places of its kinds, photos, or counties. */
async function cardCount(sql: Sql, me: string, card: SquareCard): Promise<number> {
  if (card.photo) {
    const rows = await sql<{ n: number }>`select count(*)::int as n from photos where user_id = ${me}`;
    return Number(rows[0]?.n ?? 0);
  }
  const cats = card.county ? ["county"] : card.cats ?? [];
  if (!cats.length) return 0;
  // A place counts once per visit (one without visit rows is its first).
  const rows = await sql<{ n: number }>`
    select coalesce(sum(greatest(1, case when left(ltrim(coalesce(visits, '')), 1) = '[' then jsonb_array_length(visits::jsonb) else 0 end)), 0)::int as n
    from marks where user_id = ${me} and category = any(${cats}::text[])
  `;
  return Number(rows[0]?.n ?? 0);
}

type CardRow = { card: string; dealt: number; done: number | null; base: number };

async function cardsOf(sql: Sql, board: string, me: string): Promise<CardRow[]> {
  try {
    const rows = await sql<{ card: string; dealt: number; done: number | null; base: number }>`
      select card, (extract(epoch from dealt_at) * 1000)::float8 as dealt, (extract(epoch from done_at) * 1000)::float8 as done, base
      from square_cards where board_id = ${board} and user_id = ${me} order by dealt_at
    `;
    return rows.map((row) => ({ card: row.card, dealt: Math.round(Number(row.dealt)), done: row.done == null ? null : Math.round(Number(row.done)), base: Number(row.base) }));
  } catch {
    return [];
  }
}

/** The card you're holding, if it's not done yet (checked now: done ones are marked done). */
async function holdingCard(sql: Sql, board: string, me: string): Promise<CardRow | null> {
  const open = (await cardsOf(sql, board, me)).find((row) => row.done == null);
  if (!open) return null;
  const card = cardById(open.card);
  // "Go to" cards in a game with a deck are done by getting there (playCard); older games count visits.
  const byPlace = Boolean(card?.osm) || (Boolean(card?.cats) && (await deckOf(sql, board)) != null);
  const done =
    !card ||
    card.wild ||
    (card.wait != null && Date.now() >= open.dealt + card.wait * 60_000) ||
    (!byPlace && !card.grid && (card.cats || card.photo || card.county) && (await cardCount(sql, me, card)) > open.base);
  if (!done) return open;
  await sql`update square_cards set done_at = now() where board_id = ${board} and user_id = ${me} and done_at is null`;
  return null;
}

/** Your stretches of holding a card, [from, to] (to null: holding one now). */
async function blocksOf(sql: Sql, board: string, me: string): Promise<Pauses> {
  return (await cardsOf(sql, board, me)).map((row) => [row.dealt, row.done]);
}

type Dealt = { card: string; at: number; wild: boolean; targets: [string, string, number, number][]; grid?: HeldGrid };

/** Where a grid card points, for this player now (empty for the ones checked as you go: a run, after dark). */
function gridSquares(rule: GridRule, grid: Grid, game: SquaresGame, me: string, visits: { square: number; user: string }[], from: number | null): number[] {
  const visited = new Set(visits.map((v) => v.square));
  const mine = new Set(visits.filter((v) => v.user === me).map((v) => v.square));
  const ours = game.mode === "together" ? visited : mine;
  if (rule === "corner") {
    const corners = cornerSquares(grid);
    const open = corners.filter((n) => !ours.has(n));
    const pick = (open.length ? open : corners)[Math.floor(Math.random() * (open.length || corners.length))];
    return [pick];
  }
  if (rule === "middle") return [middleSquare(grid)];
  if (rule === "edge") return edgeSquares(grid);
  if (rule === "far") {
    const far = farSquare(grid, from ?? middleSquare(grid), visited);
    return far == null ? [] : [far];
  }
  if (rule === "start") {
    const first = visits.find((v) => v.user === me);
    return first ? [first.square] : [];
  }
  if (rule === "hole") return holeSquares(grid, ours, visited);
  if (rule === "ink") {
    const firsts = new Map<number, string>();
    for (const v of visits) if (!firsts.has(v.square)) firsts.set(v.square, v.user);
    return [...firsts].filter(([, who]) => who !== me).map(([n]) => n);
  }
  return [];
}

async function deal(sql: Sql, board: string, me: string, not: string | null, swap = false, from: number | null = null, force: string | null = null): Promise<Dealt> {
  const deck = await deckOf(sql, board);
  const game = await gameOf(sql, board);
  const grid = game ? gridOf(game) : null;
  const visits = game ? await visitsOf(sql, board) : [];
  const ctx: DealContext = {};
  if (game && grid) {
    const visited = new Set(visits.map((v) => v.square));
    const mine = new Set(visits.filter((v) => v.user === me).map((v) => v.square));
    const [clat, clon] = squareCenter(grid, middleSquare(grid));
    ctx.hard = game.hard;
    ctx.progress = game.total ? visited.size / game.total : 0;
    ctx.race = game.mode === "race";
    ctx.inkSquares = visits.some((v) => v.user !== me) ? 1 : 0;
    ctx.holes = holeSquares(grid, game.mode === "together" ? visited : mine, visited).length;
    ctx.hasStart = mine.size > 1;
    ctx.nearDark = isDark(clat, clon, Date.now(), 2 * 3600_000);
    ctx.swap = swap;
    // Grid cards only in a game the new app has opened (it looks up the places, so spots_at is set);
    // an older app would be dealt a card it can't do.
    const opened = await sql<{ ok: boolean }>`select spots_at is not null as ok from square_games where board_id = ${board}`;
    ctx.noGrid = !opened[0]?.ok;
  }
  const card = (force ? cardById(force) : null) ?? drawCard(not, deck, ctx);
  const base = await cardCount(sql, me, card);
  const squares = card.grid && game && grid ? gridSquares(card.grid, grid, game, me, visits, from) : null;
  const rows = await sql<{ at: number }>`
    insert into square_cards (board_id, user_id, card, base, done_at, squares)
    values (${board}, ${me}, ${card.id}, ${base}, ${card.wild ? new Date() : null}, ${squares ? JSON.stringify(squares) : null}::jsonb)
    returning (extract(epoch from dealt_at) * 1000)::float8 as at
  `;
  return {
    card: card.id,
    at: Math.round(Number(rows[0]?.at ?? Date.now())),
    wild: Boolean(card.wild),
    targets: card.cats || card.osm ? await targetsFor(sql, board, me, card.id, deck) : [],
    ...(card.grid ? { grid: { rule: card.grid, squares: squares ?? [] } } : {}),
  };
}

/** The grid card you're holding, with its squares. */
async function heldGrid(sql: Sql, board: string, me: string, card: string): Promise<HeldGrid | undefined> {
  const info = cardById(card);
  if (!info?.grid) return undefined;
  const rows = await sql<{ squares: unknown }>`select squares from square_cards where board_id = ${board} and user_id = ${me} and done_at is null order by dealt_at desc limit 1`;
  const raw = rows[0]?.squares;
  const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  return { rule: info.grid, squares: Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n)) : [] };
}

/** Paused stretches, [from, to] in ms (to null: paused now). */
export type Pauses = [number, number | null][];

async function pausesOf(sql: Sql, id: string): Promise<{ list: Pauses; open: { by: string; since: number } | null }> {
  try {
    const rows = await sql<{ s: number; e: number | null; by_user: string }>`
      select (extract(epoch from started_at) * 1000)::float8 as s, (extract(epoch from ended_at) * 1000)::float8 as e, by_user
      from square_pauses where board_id = ${id} order by started_at
    `;
    const list: Pauses = rows.map((row) => [Math.round(Number(row.s)), row.e == null ? null : Math.round(Number(row.e))]);
    const last = rows.at(-1);
    return { list, open: last && last.e == null ? { by: last.by_user, since: Math.round(Number(last.s)) } : null };
  } catch {
    // Before the migration.
    return { list: [], open: null };
  }
}

/** Whether a stretch of travel [from, to] touches a paused stretch. */
export function overlapsPause(pauses: Pauses, from: number, to: number) {
  return pauses.some(([s, e]) => s <= to && (e == null || e >= from));
}

type Sql = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;
const ZOOMS = new Set<number>(SQUARE_SIZES.map((size) => size.zoom));

async function open(sql: Sql, me: string, id: string) {
  const { loadAccess } = await import("@/lib/boards");
  const access = await loadAccess(sql, me, id);
  if (access.board.kind !== "squares") throw new Error("That isn't a city squares board.");
  return access;
}

async function gameOf(sql: Sql, id: string): Promise<SquaresGame | null> {
  const rows = await sql<{ city: string; place_kind: string; travel: string; cards: boolean; hard: boolean; state: string; geoid: string; zoom: number; mode: string; x0: number; y0: number; w: number; h: number; mask: string; total: number; started: number }>`
    select city, place_kind, travel, cards, hard, state, geoid, zoom, mode, x0, y0, w, h, mask, total, (extract(epoch from started_at) * 1000)::float8 as started
    from square_games where board_id = ${id}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    city: row.city,
    place: row.place_kind === "state" || row.place_kind === "national" || row.place_kind === "county" ? row.place_kind : "city",
    travel: row.travel === "foot" || row.travel === "bike" ? row.travel : "car",
    cards: Boolean(row.cards),
    hard: Boolean(row.hard),
    state: row.state,
    geoid: row.geoid,
    zoom: Number(row.zoom),
    mode: row.mode === "race" ? "race" : "together",
    x0: Number(row.x0),
    y0: Number(row.y0),
    w: Number(row.w),
    h: Number(row.h),
    mask: row.mask,
    total: Number(row.total),
    startedAt: Math.round(Number(row.started)),
  };
}

function gridOf(game: SquaresGame): Grid {
  return { zoom: game.zoom, x0: game.x0, y0: game.y0, w: game.w, h: game.h, mask: maskFromText(game.mask), count: game.total };
}

const idOf = (input: unknown) => {
  const id = String((input as { id?: unknown } | null)?.id ?? "");
  if (!/^bd-[a-z0-9]{8,24}$/.test(id)) throw new Error("Unknown board");
  return id;
};

async function cardState(sql: Sql, board: string, me: string, game: SquaresGame | null, players: string[]) {
  const holding: SquaresState["holding"] = {};
  let played: SquaresState["played"] = [];
  let swapsLeft = CARD_SWAPS;
  if (!game?.cards) return { holding, played, swapsLeft: 0 };
  await holdingCard(sql, board, me);
  for (const id of players) {
    const rows = await cardsOf(sql, board, id);
    const open = rows.find((row) => row.done == null);
    if (open) {
      const info = cardById(open.card);
      holding[id] = {
        card: open.card,
        since: open.dealt,
        ...(id === me && (info?.cats || info?.osm) ? { targets: await targetsFor(sql, board, me, open.card, await deckOf(sql, board)) } : {}),
        ...(id === me && info?.grid ? { grid: await heldGrid(sql, board, me, open.card) } : {}),
      };
    }
    if (id === me) played = rows.filter((row) => row.done != null).reverse().map((row) => ({ card: row.card, at: row.done ?? row.dealt }));
  }
  try {
    const used = await sql<{ n: number }>`select count(*)::int as n from square_cards where board_id = ${board} and user_id = ${me} and swapped`;
    swapsLeft = Math.max(0, CARD_SWAPS - Number(used[0]?.n ?? 0));
  } catch {
    // Before the migration.
  }
  return { holding, played, swapsLeft };
}

/** The time zone a game's days run on (one for everyone in it): the state's main one. */
function zoneOf(state: string) {
  if (["CA", "WA", "OR", "NV"].includes(state)) return "America/Los_Angeles";
  if (["AZ"].includes(state)) return "America/Phoenix";
  if (["CO", "ID", "MT", "NM", "UT", "WY"].includes(state)) return "America/Denver";
  if (["AL", "AR", "IL", "IA", "KS", "LA", "MN", "MS", "MO", "NE", "ND", "OK", "SD", "TN", "TX", "WI"].includes(state)) return "America/Chicago";
  if (state === "AK") return "America/Anchorage";
  if (state === "HI") return "Pacific/Honolulu";
  return "America/New_York";
}

/** Today in a game's time zone: its date ("2026-11-28") and when it started (ms). */
function gameDay(state: string, now = Date.now()) {
  const zone = zoneOf(state);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = asUtc - Math.floor(now / 1000) * 1000;
  const start = Date.UTC(get("year"), get("month") - 1, get("day")) - offset;
  return { date: `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`, start };
}

/** Today's squares in a game, and who got which of them today. */
function todayFor(board: string, game: SquaresGame, visits: { square: number; user: string; at: number }[]) {
  const { date, start } = gameDay(game.state);
  const before = new Set(visits.filter((v) => v.at < start).map((v) => v.square));
  const today = todaysSquares(gridOf(game), `${board}:${date}`, before);
  const bonus: Record<string, number> = {};
  for (const n of today) {
    const first = visits.find((v) => v.square === n && v.at >= start);
    if (first) bonus[first.user] = (bonus[first.user] ?? 0) + 1;
  }
  return { today, bonus };
}

/** Start the game: the city and its grid (worked out on the phone from the city's outline), size and mode. Once, by the board's owner. */
export const setupSquares = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const zoom = Number(row.zoom);
    if (!ZOOMS.has(zoom)) throw new Error("Pick a square size");
    const int = (v: unknown) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 2 ** 20) throw new Error("That grid doesn't look right");
      return n;
    };
    const w = int(row.w);
    const h = int(row.h);
    if (w < 1 || h < 1 || w * h > 4_000_000) throw new Error("That city is too big at this size");
    const mask = String(row.mask ?? "");
    if (!/^[A-Za-z0-9+/=]+$/.test(mask) || mask.length > 800_000) throw new Error("That grid doesn't look right");
    return {
      id: idOf(input),
      geoid: String(row.geoid ?? "").slice(0, 40),
      place: row.place === "state" || row.place === "national" || row.place === "county" ? (row.place as SquaresPlace) : ("city" as const),
      deck: parseDeck(row.deck),
      city: String(row.city ?? "").trim().slice(0, 80),
      state: String(row.state ?? "").toUpperCase().slice(0, 2),
      zoom,
      mode: row.mode === "race" ? ("race" as const) : ("together" as const),
      travel: row.travel === "foot" || row.travel === "bike" ? (row.travel as TravelMode) : ("car" as const),
      cards: row.cards === true,
      hard: row.hard === true,
      x0: int(row.x0),
      y0: int(row.y0),
      w,
      h,
      mask,
    };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const { role } = await open(sql, context.userId, data.id);
    if (role !== "owner") throw new Error("Only the person who made the board can pick the place.");
    if (!data.city || !/^[A-Z]{2}$/.test(data.state)) throw new Error("Pick a place");
    const grid: Grid = { zoom: data.zoom, x0: data.x0, y0: data.y0, w: data.w, h: data.h, mask: maskFromText(data.mask), count: 0 };
    if (grid.mask.length !== Math.ceil((data.w * data.h) / 8)) throw new Error("That grid doesn't look right");
    let total = 0;
    for (let i = 0; i < data.w * data.h; i++) if (inGrid(grid, i)) total++;
    if (total < 1) throw new Error("That city has no squares at this size. Try a smaller size.");
    if (total > MAX_SQUARES) throw new Error(`That's ${total.toLocaleString()} squares. Try a bigger size.`);
    const made = await sql<{ ok: boolean }>`
      insert into square_games (board_id, geoid, city, place_kind, travel, cards, hard, deck, state, zoom, mode, x0, y0, w, h, mask, total)
      values (${data.id}, ${data.geoid}, ${data.city}, ${data.place}, ${data.travel}, ${data.cards}, ${data.hard}, ${data.deck ? JSON.stringify(data.deck) : null}::jsonb, ${data.state}, ${data.zoom}, ${data.mode}, ${data.x0}, ${data.y0}, ${data.w}, ${data.h}, ${data.mask}, ${total})
      on conflict (board_id) do nothing
      returning true as ok
    `;
    if (!made[0]?.ok) throw new Error("This board already has a place.");
    await sql`update boards set title = ${`${data.city} squares`.slice(0, 60)}, updated_at = now() where id = ${data.id}`;
    return { ok: true as const, total };
  });

/** The game as it stands: the grid, who's playing, and everyone's squares. */
export const squaresState = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: idOf(input) }))
  .handler(async ({ context, data }): Promise<SquaresState> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const { board, role } = await open(sql, context.userId, data.id);
    const { boardPeople } = await import("@/lib/boards");
    const players = await boardPeople(sql, data.id, board.owner_id);
    const game = await gameOf(sql, data.id);
    const firsts: Record<string, string> = {};
    const visits: Record<string, number> = {};
    let skips = "";
    let today: number[] = [];
    let bonus: Record<string, number> = {};
    if (game) {
      ({ today, bonus } = todayFor(data.id, game, await visitsOf(sql, data.id)));
      // Who got to each square first (ties: whoever's id sorts first, so it's always the same).
      const first = await sql<{ square: number; user_id: string }>`
        select distinct on (square) square, user_id from square_visits
        where board_id = ${data.id} and how = 'visit'
        order by square, at, user_id
      `;
      const by = new Map<string, number[]>();
      for (const row of first) by.set(row.user_id, [...(by.get(row.user_id) ?? []), Number(row.square)]);
      for (const [id, squares] of by) firsts[id] = packSquares(squares);
      const counts = await sql<{ user_id: string; n: number }>`
        select user_id, count(*)::int as n from square_visits where board_id = ${data.id} and how = 'visit' group by user_id
      `;
      for (const row of counts) visits[row.user_id] = Number(row.n);
      const skipped = await sql<{ square: number }>`select distinct square from square_visits where board_id = ${data.id} and how = 'skip'`;
      skips = packSquares(skipped.map((row) => Number(row.square)));
    }
    return {
      game,
      me: context.userId,
      owner: role === "owner",
      players,
      firsts,
      visits,
      skips,
      skipsAllowed: game && game.mode === "together" ? skipsFor(game.total) : 0,
      paused: game ? (await pausesOf(sql, data.id)).open : null,
      today,
      bonus,
      ...(await cardState(sql, data.id, context.userId, game, players.map((p) => p.id))),
    };
  });

/**
 * Squares you've just been through (from tracking). `at`: when (the earliest
 * of them), which decides races. Only after the game started; only the
 * city's squares.
 */
export const addSquares = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const squares = unpackSquares(String(row.squares ?? "").slice(0, 60_000)).slice(0, 5000);
    if (squares.some((n) => !Number.isInteger(n) || n < 0)) throw new Error("Those squares don't look right");
    const at = Number(row.at);
    const last = Number(row.last);
    const from = Number.isFinite(at) ? at : Date.now();
    return { id: idOf(input), squares, at: from, last: Number.isFinite(last) && last >= from ? last : from };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await open(sql, context.userId, data.id);
    const game = await gameOf(sql, data.id);
    if (!game) throw new Error("Pick a city first.");
    const grid = gridOf(game);
    // Nothing from while the game was paused (the phone splits its batches at pauses it knows about,
    // and hears about the others here).
    const pauses = await pausesOf(sql, data.id);
    if (overlapsPause(pauses.list, data.at, data.last)) return { added: 0, paused: true as const, pauses: pauses.list };
    // Holding a card that isn't done: nothing counts until it is (nor squares from while you held one).
    if (game.cards) {
      await holdingCard(sql, data.id, context.userId);
      const blocks = await blocksOf(sql, data.id, context.userId);
      if (overlapsPause(blocks, data.at, data.last)) return { added: 0, blocked: true as const, blocks };
    }
    // Not before the game started, not in the future.
    const at = Math.min(Date.now(), Math.max(game.startedAt, data.at));
    let fresh = data.squares.filter((n) => inGrid(grid, n));
    if (!fresh.length) return { added: 0 };
    // Hard: a new square only counts if it touches one you have (in Together, one anybody has).
    if (game.hard) {
      const all = await visitsOf(sql, data.id);
      const have = new Set(all.filter((v) => game.mode === "together" || v.user === context.userId).map((v) => v.square));
      fresh = touching(grid, have, fresh);
      if (!fresh.length) return { added: 0, kept: "" };
    }
    const added = await sql<{ square: number }>`
      insert into square_visits (board_id, user_id, square, at, how)
      select ${data.id}, ${context.userId}, s, to_timestamp(${at / 1000}), 'visit' from unnest(${fresh}::int[]) as s
      on conflict (board_id, user_id, square) do update set how = 'visit', at = least(square_visits.at, excluded.at)
        where square_visits.how = 'skip'
      returning square
    `;
    // A visited square no longer needs anyone's skip.
    await sql`delete from square_visits where board_id = ${data.id} and how = 'skip' and square = any(${fresh}::int[])`;
    if (added.length) await sql`update boards set updated_at = now() where id = ${data.id}`;
    // Now and then a new square deals a card.
    let dealt: Dealt | null = null;
    if (game.cards && added.length && added.some(() => Math.random() < 1 / CARD_EVERY)) {
      const last = (await cardsOf(sql, data.id, context.userId)).at(-1)?.card ?? null;
      dealt = await deal(sql, data.id, context.userId, last, false, Number(added.at(-1)?.square ?? fresh.at(-1)));
    }
    // kept: which of the squares sent counted (a Hard game turns away ones that don't touch yours).
    return { added: added.length, dealt, kept: packSquares(fresh) };
  });

/** Skip a square nobody can get into (Together only), or take the skip back. */
export const skipSquare = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const square = Number(row.square);
    if (!Number.isInteger(square) || square < 0) throw new Error("Unknown square");
    return { id: idOf(input), square, on: row.on !== false };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await open(sql, context.userId, data.id);
    const game = await gameOf(sql, data.id);
    if (!game) throw new Error("Pick a city first.");
    if (game.mode !== "together") throw new Error("There are no skips in a race.");
    if (!inGrid(gridOf(game), data.square)) throw new Error("That square isn't in the city.");
    if (!data.on) {
      await sql`delete from square_visits where board_id = ${data.id} and square = ${data.square} and how = 'skip'`;
      return { ok: true };
    }
    const visited = await sql<{ ok: boolean }>`select true as ok from square_visits where board_id = ${data.id} and square = ${data.square} and how = 'visit' limit 1`;
    if (visited[0]?.ok) throw new Error("Somebody's already been there.");
    const used = await sql<{ n: number }>`select count(distinct square)::int as n from square_visits where board_id = ${data.id} and how = 'skip'`;
    if (Number(used[0]?.n ?? 0) >= skipsFor(game.total)) throw new Error("No skips left on this card.");
    await sql`
      insert into square_visits (board_id, user_id, square, at, how) values (${data.id}, ${context.userId}, ${data.square}, now(), 'skip')
      on conflict (board_id, user_id, square) do nothing
    `;
    return { ok: true };
  });

export type ActiveSquares = { id: string; hard?: boolean; mode?: SquaresMode; card: { id: string; targets: [string, string, number, number][]; grid?: HeldGrid } | null; blocks: Pauses; travel: TravelMode; zoom: number; x0: number; y0: number; w: number; h: number; mask: string; startedAt: number; mine: string; pauses: Pauses };

/** The games you're in, for tracking to fill in (with the squares you already have, so they're not sent again). */
export const myActiveSquares = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ActiveSquares[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    try {
      const rows = await sql<{ board_id: string; travel: string; hard: boolean; mode: string; zoom: number; x0: number; y0: number; w: number; h: number; mask: string; started: number }>`
        select g.board_id, g.travel, g.hard, g.mode, g.zoom, g.x0, g.y0, g.w, g.h, g.mask, (extract(epoch from g.started_at) * 1000)::float8 as started
        from square_games g join boards b on b.id = g.board_id
        left join board_shares s on s.board_id = b.id and s.user_id = ${context.userId}
        where b.owner_id = ${context.userId} or s.user_id = ${context.userId}
        limit 10
      `;
      const out: ActiveSquares[] = [];
      for (const row of rows) {
        const mine = await sql<{ square: number }>`select square from square_visits where board_id = ${row.board_id} and user_id = ${context.userId} and how = 'visit'`;
        out.push({
          id: row.board_id,
          hard: Boolean(row.hard),
          mode: row.mode === "race" ? "race" : "together",
          travel: row.travel === "foot" || row.travel === "bike" ? row.travel : "car",
          zoom: Number(row.zoom),
          x0: Number(row.x0),
          y0: Number(row.y0),
          w: Number(row.w),
          h: Number(row.h),
          mask: row.mask,
          startedAt: Math.round(Number(row.started)),
          mine: packSquares(mine.map((m) => Number(m.square))),
          pauses: (await pausesOf(sql, row.board_id)).list,
          blocks: await blocksOf(sql, row.board_id, context.userId),
          card: await (async () => {
            const held = await holdingCard(sql, row.board_id, context.userId);
            const info = held ? cardById(held.card) : null;
            if (!held || !info) return null;
            if (info.grid) return { id: held.card, targets: [], grid: await heldGrid(sql, row.board_id, context.userId, held.card) };
            if (!info.cats && !info.osm) return null;
            return { id: held.card, targets: await targetsFor(sql, row.board_id, context.userId, held.card, await deckOf(sql, row.board_id)) };
          })(),
        });
      }
      return out;
    } catch {
      // Before the migration.
      return [];
    }
  });

/** Pause the game (on) or carry on (off). Any player. */
export const pauseSquares = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: idOf(input), on: (input as { on?: unknown } | null)?.on !== false }))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await open(sql, context.userId, data.id);
    if (!(await gameOf(sql, data.id))) throw new Error("Pick a city first.");
    const { open: now } = await pausesOf(sql, data.id);
    if (data.on && !now) {
      await sql`insert into square_pauses (board_id, started_at, by_user) values (${data.id}, now(), ${context.userId}) on conflict do nothing`;
    } else if (!data.on && now) {
      await sql`update square_pauses set ended_at = now() where board_id = ${data.id} and ended_at is null`;
    }
    await sql`update boards set updated_at = now() where id = ${data.id}`;
    return { ok: true as const };
  });

/** Swap the card you're holding for another (one that can't be done nearby). A few per game. */
export const swapCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: idOf(input) }))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await open(sql, context.userId, data.id);
    const game = await gameOf(sql, data.id);
    if (!game?.cards) throw new Error("This game has no cards.");
    const holding = await holdingCard(sql, data.id, context.userId);
    if (!holding) throw new Error("You're not holding a card.");
    const used = await sql<{ n: number }>`select count(*)::int as n from square_cards where board_id = ${data.id} and user_id = ${context.userId} and swapped`;
    if (Number(used[0]?.n ?? 0) >= CARD_SWAPS) throw new Error("No swaps left.");
    await sql`update square_cards set done_at = now(), swapped = true where board_id = ${data.id} and user_id = ${context.userId} and done_at is null`;
    return { dealt: await deal(sql, data.id, context.userId, holding.card, true) };
  });

/**
 * "I'm here": you've stopped at one of the card's places and tapped the card.
 * Your location (fresh from the phone) has to be within 100 feet of the
 * place; the place has to be one of the card's (inside the game's area) and
 * not one that's already done a card for you in this game.
 */
export const playCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const place = String(row.place ?? "").slice(0, 140);
    const square = Number(row.square);
    const run = Array.isArray(row.run) ? row.run.map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 12) : [];
    if (!place && !Number.isInteger(square)) throw new Error("Which place?");
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("Where are you?");
    return { id: idOf(input), place, square: Number.isInteger(square) ? square : null, run, lat, lon };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await open(sql, context.userId, data.id);
    const held = await holdingCard(sql, data.id, context.userId);
    if (!held) return { done: false, why: "You're not holding a card." };
    const info = cardById(held.card);
    if (info?.grid) {
      // A grid card: you have to be standing in the square, and it has to be one the card asks for.
      const game = await gameOf(sql, data.id);
      if (!game || data.square == null) return { done: false, why: "Which square?" };
      const grid = gridOf(game);
      if (squareAt(grid, data.lat, data.lon) !== data.square) return { done: false, why: "You're not in that square." };
      const visits = await visitsOf(sql, data.id);
      const mine = new Set(visits.filter((v) => v.user === context.userId).map((v) => v.square));
      const rule = info.grid;
      const held2 = await heldGrid(sql, data.id, context.userId, held.card);
      let ok = false;
      let earned = [data.square];
      if (rule === "run") {
        earned = data.run.length >= 5 ? data.run.slice(-5) : [];
        ok = earned.length === 5 && earned.at(-1) === data.square && straightRun(grid, earned) && earned.every((n) => inGrid(grid, n) && !mine.has(n));
      } else if (rule === "dark") {
        const [clat, clon] = squareCenter(grid, data.square);
        ok = !mine.has(data.square) && isDark(clat, clon);
        if (!ok && isDark(clat, clon)) return { done: false, why: "That square isn't a new one." };
        if (!ok) return { done: false, why: "Not dark yet." };
      } else {
        ok = (held2?.squares ?? []).includes(data.square);
      }
      if (!ok) return { done: false, why: "That square doesn't do this card." };
      await sql`update square_cards set done_at = now() where board_id = ${data.id} and user_id = ${context.userId} and done_at is null`;
      // The square(s) the card took you to count, too.
      const counted = earned.filter((n) => inGrid(grid, n) && !mine.has(n));
      if (counted.length)
        await sql`
          insert into square_visits (board_id, user_id, square, at, how)
          select ${data.id}, ${context.userId}, s, now(), 'visit' from unnest(${counted}::int[]) as s
          on conflict (board_id, user_id, square) do update set how = 'visit', at = least(square_visits.at, excluded.at) where square_visits.how = 'skip'
        `;
      await sql`update boards set updated_at = now() where id = ${data.id}`;
      return { done: true, card: held.card, place: info.name, at: Date.now(), squares: packSquares(counted) };
    }
    const targets = await targetsFor(sql, data.id, context.userId, held.card, await deckOf(sql, data.id));
    const place = targets.find(([id]) => id === data.place);
    if (!place) return { done: false, why: "That place doesn't do this card (or it already did one)." };
    const feet = Math.hypot((place[2] - data.lat) * 69, (place[3] - data.lon) * 69 * Math.cos((data.lat * Math.PI) / 180)) * 5280;
    if (feet > CARD_REACH_MILES * 5280) return { done: false, why: `You're ${Math.round(feet).toLocaleString()} ft from ${place[1]}. Get within 100 ft.` };
    await sql`update square_cards set done_at = now(), place = ${data.place} where board_id = ${data.id} and user_id = ${context.userId} and done_at is null`;
    await sql`update boards set updated_at = now() where id = ${data.id}`;
    return { done: true, card: held.card, place: place[1], at: Date.now() };
  });

/**
 * The game's everyday places for the game map and the everyday-place cards,
 * looked up from OpenStreetMap the first time they're wanted (and tried again
 * at most every 10 minutes if that didn't work).
 */
export const loadSpots = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: idOf(input) }))
  .handler(async ({ context, data }): Promise<{ spots: GameSpot[] | null }> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await open(sql, context.userId, data.id);
    const game = await gameOf(sql, data.id);
    if (!game) return { spots: null };
    const rows = await sql<{ spots: unknown; tried: number | null }>`
      select spots, (extract(epoch from spots_at) * 1000)::float8 as tried from square_games where board_id = ${data.id}
    `;
    if (rows[0]?.spots != null) return { spots: readSpots(rows[0].spots) };
    const tried = rows[0]?.tried == null ? 0 : Number(rows[0].tried);
    if (Date.now() - tried < 10 * 60_000) return { spots: null };
    await sql`update square_games set spots_at = now() where board_id = ${data.id}`;
    const grid = gridOf(game);
    const box: [number, number, number, number] = [latOf(grid.y0 + grid.h, grid.zoom), lonOf(grid.x0, grid.zoom), latOf(grid.y0, grid.zoom), lonOf(grid.x0 + grid.w, grid.zoom)];
    try {
      const { lookUpSpots } = await import("@/lib/spots.server");
      const spots = await lookUpSpots(box, (lat, lon) => squareAt(grid, lat, lon) >= 0);
      await sql`update square_games set spots = ${JSON.stringify(spots)}::jsonb where board_id = ${data.id}`;
      return { spots };
    } catch {
      return { spots: null };
    }
  });

/** Development only (browser tests): deal a particular card, so each kind can be tried. */
export const devDealCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: idOf(input), card: String((input as { card?: unknown } | null)?.card ?? "") }))
  .handler(async ({ context, data }) => {
    if (!import.meta.env.DEV) throw new Error("Not here.");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await open(sql, context.userId, data.id);
    await sql`update square_cards set done_at = now() where board_id = ${data.id} and user_id = ${context.userId} and done_at is null`;
    return { dealt: await deal(sql, data.id, context.userId, null, false, null, data.card) };
  });
