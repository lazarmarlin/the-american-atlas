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
 * Any player can pause the game (one of you has to leave) and any player can
 * carry on. While it's paused tracking adds nobody's squares: the server
 * turns away squares from any paused stretch, even ones a phone sends later.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { MAX_SQUARES, SQUARE_SIZES, type TravelMode, inGrid, maskFromText, packSquares, skipsFor, unpackSquares, type Grid } from "@/lib/city-grid";

export type SquaresMode = "together" | "race";
/** What's cut into squares: a city or town, a state park, or a national park. */
export type SquaresPlace = "city" | "state" | "national";

export type SquaresGame = {
  /** The place's name (a city, or a park). */
  city: string;
  place: SquaresPlace;
  /** On foot, bike or car: squares only count at that speed or slower. */
  travel: TravelMode;
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
};

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
  const rows = await sql<{ city: string; place_kind: string; travel: string; state: string; geoid: string; zoom: number; mode: string; x0: number; y0: number; w: number; h: number; mask: string; total: number; started: number }>`
    select city, place_kind, travel, state, geoid, zoom, mode, x0, y0, w, h, mask, total, (extract(epoch from started_at) * 1000)::float8 as started
    from square_games where board_id = ${id}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    city: row.city,
    place: row.place_kind === "state" || row.place_kind === "national" ? row.place_kind : "city",
    travel: row.travel === "foot" || row.travel === "bike" ? row.travel : "car",
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
      place: row.place === "state" || row.place === "national" ? (row.place as SquaresPlace) : ("city" as const),
      city: String(row.city ?? "").trim().slice(0, 80),
      state: String(row.state ?? "").toUpperCase().slice(0, 2),
      zoom,
      mode: row.mode === "race" ? ("race" as const) : ("together" as const),
      travel: row.travel === "foot" || row.travel === "bike" ? (row.travel as TravelMode) : ("car" as const),
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
      insert into square_games (board_id, geoid, city, place_kind, travel, state, zoom, mode, x0, y0, w, h, mask, total)
      values (${data.id}, ${data.geoid}, ${data.city}, ${data.place}, ${data.travel}, ${data.state}, ${data.zoom}, ${data.mode}, ${data.x0}, ${data.y0}, ${data.w}, ${data.h}, ${data.mask}, ${total})
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
    if (game) {
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
    // Not before the game started, not in the future.
    const at = Math.min(Date.now(), Math.max(game.startedAt, data.at));
    const fresh = data.squares.filter((n) => inGrid(grid, n));
    if (!fresh.length) return { added: 0 };
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
    return { added: added.length };
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

export type ActiveSquares = { id: string; travel: TravelMode; zoom: number; x0: number; y0: number; w: number; h: number; mask: string; startedAt: number; mine: string; pauses: Pauses };

/** The games you're in, for tracking to fill in (with the squares you already have, so they're not sent again). */
export const myActiveSquares = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ActiveSquares[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    try {
      const rows = await sql<{ board_id: string; travel: string; zoom: number; x0: number; y0: number; w: number; h: number; mask: string; started: number }>`
        select g.board_id, g.travel, g.zoom, g.x0, g.y0, g.w, g.h, g.mask, (extract(epoch from g.started_at) * 1000)::float8 as started
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
