/**
 * Tracking fills in City squares: every fix (from the app, or what the phone
 * logged while the app was closed) is checked against the games you're in,
 * along the whole stretch since the fix before, so a fast drive doesn't skip
 * squares between fixes. New squares are sent in batches (every 15 s, or
 * sooner when there are lots).
 *
 * Not counted: rough fixes (poor accuracy), fixes from before the game
 * started or while it's paused, and gaps of more than two minutes or two
 * miles (lost signal: the straight line between might not be where you went).
 * In an on-foot or bike game, stretches faster than its limit (12 or 25 mph)
 * don't count either, and a lone fix with nothing to measure speed against
 * waits for the next one. Nor while you're holding a modifier card that isn't
 * done (the server says so when it deals one, or when a send is turned away).
 * A pause this phone hasn't heard of yet comes back from the server when it
 * sends; those squares are dropped.
 *
 * Hard games: a square only counts once you've been in it for about 20
 * seconds (two fixes in it that far apart; passing through doesn't), and the
 * server only keeps new squares that touch yours.
 *
 * Holding a grid card (a corner, the far side, five in a row, after dark…):
 * squares don't count, but each fix is checked against the card, and when it
 * does what the card asks the phone tells the server, which checks again.
 */
import type { Fix } from "@/lib/nearby";
import { DWELL_MS, inGrid, maxMphFor, maskFromText, middleSquare, packSquares, squareAt, squareCenter, squaresAlong, straightRun, unpackSquares, type Grid } from "@/lib/city-grid";
import { cardDealt, cardFinished, squaresChanged } from "@/lib/squares-map";
import { cardById } from "@/lib/square-cards";
import type { HeldGrid, Pauses } from "@/lib/city-squares";
import { isDark } from "@/lib/sun";

/** pending: squares found but not sent yet, with when. */
type Target = [string, string, number, number];
/** card: the "go to" card you're holding, and its places inside the area. */
type Game = {
  id: string;
  grid: Grid;
  maxMph: number | null;
  startedAt: number;
  mine: Set<number>;
  pending: Map<number, number>;
  pauses: Pauses;
  blocks: Pauses;
  card: { id: string; targets: Target[]; grid?: HeldGrid } | null;
  playing: boolean;
  hard: boolean;
  /** Hard: the square you're in and since when (it counts after DWELL_MS). */
  here: { n: number; since: number } | null;
  /** A straight-run card: the new squares you've gone through since, in order. */
  run: number[];
};

const paused = (pauses: Pauses, t: number) => pauses.some(([s, e]) => t >= s && (e == null || t <= e));
const pauseBetween = (pauses: Pauses, a: number, b: number) => pauses.some(([s, e]) => s <= b && (e == null || e >= a));

const GAP_MS = 2 * 60_000;
const GAP_MILES = 2;
const RELOAD_MS = 10 * 60_000;

let games: Game[] = [];
let loadedAt = 0;
let loading: Promise<void> | null = null;
let last: { lat: number; lon: number; t: number } | null = null;
let flushTimer = 0;
let sending = false;

function miles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dy = (a.lat - b.lat) * 69;
  const dx = (a.lon - b.lon) * 69 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** Look up the games you're in (on start, after a game starts, and every 10 minutes). */
export function refreshSquareGames(force = false): Promise<void> {
  // Asked again while a look is under way (a game just started): look again after it, or the new game is missed.
  if (loading) return force ? loading.then(() => refreshSquareGames(true)) : loading;
  if (!force && Date.now() - loadedAt < RELOAD_MS) return Promise.resolve();
  loading = import("@/lib/city-squares")
    .then((mod) => mod.myActiveSquares())
    .then((rows) => {
      loadedAt = Date.now();
      games = rows.map((row) => {
        const old = games.find((g) => g.id === row.id);
        const grid: Grid = { zoom: row.zoom, x0: row.x0, y0: row.y0, w: row.w, h: row.h, mask: maskFromText(row.mask), count: 0 };
        const mine = new Set(unpackSquares(row.mine));
        // Squares found but not sent yet carry over (not ones from a pause just learned of).
        const pauses = row.pauses ?? [];
        const blocks = row.blocks ?? [];
        const pending = new Map([...(old?.pending ?? [])].filter(([n, t]) => !mine.has(n) && !paused(pauses, t) && !paused(blocks, t)));
        return { id: row.id, grid, maxMph: maxMphFor(row.travel), startedAt: row.startedAt, mine, pending, pauses, blocks, card: row.card ?? null, playing: false, hard: Boolean(row.hard), here: old?.here ?? null, run: old?.run ?? [] };
      });
    })
    .catch(() => {
      loadedAt = Date.now() - RELOAD_MS + 60_000; // try again in a minute
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Fixes in (any order, any age): the squares they pass through, for each game. */
export function feedSquares(fixes: Fix[]) {
  if (!games.length) {
    if (Date.now() - loadedAt > RELOAD_MS) void refreshSquareGames();
    if (!games.length) return;
  }
  const sorted = fixes.filter((fix) => !fix.rough && Number.isFinite(fix.lat) && Number.isFinite(fix.lon)).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  let found = false;
  for (const fix of sorted) {
    const t = fix.t ?? Date.now();
    const prev = last && t >= last.t && t - last.t <= GAP_MS && miles(last, fix) <= GAP_MILES ? last : null;
    for (const game of games) {
      if (t < game.startedAt || paused(game.pauses, t)) continue;
      if (paused(game.blocks, t)) {
        // Holding a card: nothing counts, but a grid card might be done by this.
        if (game.card?.grid) checkGridCard(game, fix, t, prev);
        continue;
      }
      const joined = prev && prev.t >= game.startedAt && !pauseBetween(game.pauses, prev.t, t) && !pauseBetween(game.blocks, prev.t, t);
      if (game.maxMph != null) {
        // Too fast for this game (driving in an on-foot game): this stretch doesn't count.
        if (!joined || !prev) continue;
        const hours = Math.max(1, t - prev.t) / 3_600_000;
        if (miles(prev, fix) / hours > game.maxMph) continue;
      }
      let squares = joined && prev ? squaresAlong(game.grid, prev, fix) : [squareAt(game.grid, fix.lat, fix.lon)];
      if (game.hard) {
        // Hard: only the square you've stayed in for a while (passing through doesn't count).
        const n = squareAt(game.grid, fix.lat, fix.lon);
        if (!game.here || game.here.n !== n) game.here = { n, since: t };
        squares = n >= 0 && t - game.here.since >= DWELL_MS ? [n] : [];
      }
      for (const n of squares) {
        if (n < 0 || !inGrid(game.grid, n) || game.mine.has(n) || game.pending.has(n)) continue;
        game.pending.set(n, t);
        found = true;
      }
    }
    if (!last || t >= last.t) last = { lat: fix.lat, lon: fix.lon, t };
  }
  if (!found) return;
  const many = games.some((g) => g.pending.size >= 25);
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flushSquares(), many ? 500 : 15_000);
}

/** A fix while holding a grid card: has it done what the card asks? */
function checkGridCard(game: Game, fix: Fix, t: number, prev: { lat: number; lon: number; t: number } | null) {
  const card = game.card?.grid;
  if (!card || game.playing) return;
  const n = squareAt(game.grid, fix.lat, fix.lon);
  if (n < 0) return;
  if (card.rule === "run") {
    // Every new square passed through, in order (squares between fixes too).
    const path = prev && t - prev.t <= GAP_MS ? squaresAlong(game.grid, prev, fix) : [n];
    for (const m of path) if (m >= 0 && !game.mine.has(m) && game.run.at(-1) !== m) game.run.push(m);
    game.run = game.run.slice(-8);
    const five = game.run.slice(-5);
    if (five.length === 5 && five.at(-1) === n && straightRun(game.grid, five)) void playGrid(game, n, fix, five);
    return;
  }
  if (card.rule === "dark") {
    const [lat, lon] = squareCenter(game.grid, middleSquare(game.grid));
    if (!game.mine.has(n) && isDark(lat, lon, t)) void playGrid(game, n, fix);
    return;
  }
  if (card.squares.includes(n)) void playGrid(game, n, fix);
}

async function playGrid(game: Game, square: number, fix: Fix, run: number[] = []) {
  if (game.playing || !game.card) return;
  game.playing = true;
  const held = game.card;
  try {
    const { playCard } = await import("@/lib/city-squares");
    const res = await playCard({ data: { id: game.id, square, run, lat: fix.lat, lon: fix.lon } });
    if (res.done) {
      // Done: squares count again from now, and the card's square(s) are yours.
      game.card = null;
      game.run = [];
      game.blocks = game.blocks.map(([s, e]) => [s, e ?? Date.now()] as [number, number | null]);
      for (const n of unpackSquares(("squares" in res && res.squares) || "")) game.mine.add(n);
      cardFinished(game.id, held.id, cardById(held.id)?.name ?? "");
      squaresChanged();
    }
  } catch {
    // No signal: the next fix tries again.
  } finally {
    game.playing = false;
  }
}

/** The last fix seen (for "nearest" on a card). */
export function lastSquaresFix() {
  return last;
}

/** Send the squares found since the last send. */
export async function flushSquares() {
  if (sending) return;
  sending = true;
  let sent = false;
  try {
    const { addSquares } = await import("@/lib/city-squares");
    for (const game of games) {
      if (!game.pending.size) continue;
      // In runs that don't cross a pause (the server turns away a batch that touches one).
      const sorted = [...game.pending].sort((a, b) => a[1] - b[1]);
      const runs: [number, number][][] = [];
      for (const entry of sorted) {
        const run = runs.at(-1);
        if (run && !pauseBetween(game.pauses, run[run.length - 1][1], entry[1]) && !pauseBetween(game.blocks, run[run.length - 1][1], entry[1])) run.push(entry);
        else runs.push([entry]);
      }
      for (const run of runs) {
        try {
          const res = await addSquares({ data: { id: game.id, squares: packSquares(run.map(([n]) => n)), at: run[0][1], last: run[run.length - 1][1] } });
          if ("paused" in res && res.paused) {
            // Paused (by a friend, maybe) since: those squares don't count.
            game.pauses = res.pauses;
            for (const [n, t] of run) if (paused(game.pauses, t)) game.pending.delete(n);
            continue;
          }
          if ("blocked" in res && res.blocked) {
            // Holding a card: squares from since then don't count.
            game.blocks = res.blocks;
            for (const [n, t] of run) if (paused(game.blocks, t)) game.pending.delete(n);
            continue;
          }
          // Only the squares the server kept are yours (a Hard game turns away ones that don't touch yours).
          const kept = "kept" in res && typeof res.kept === "string" ? new Set(unpackSquares(res.kept)) : null;
          for (const [n] of run) {
            if (!kept || kept.has(n)) game.mine.add(n);
            game.pending.delete(n);
          }
          sent = true;
          if ("dealt" in res && res.dealt) {
            // A card: nothing more counts until it's done (wild ones are done already).
            game.blocks = [...game.blocks, [res.dealt.at, res.dealt.wild ? res.dealt.at : null]];
            game.card = res.dealt.targets?.length || res.dealt.grid ? { id: res.dealt.card, targets: res.dealt.targets ?? [], ...(res.dealt.grid ? { grid: res.dealt.grid } : {}) } : null;
            game.run = [];
            for (const [n, t] of game.pending) if (t >= res.dealt.at && !res.dealt.wild) game.pending.delete(n);
            cardDealt(game.id, res.dealt.card);
            const card = cardById(res.dealt.card);
            if (card && !card.wild) void import("@/lib/voice").then((v) => v.announce(`City squares card: ${card.name}. ${card.task}`, "highlights", true)).catch(() => undefined);
          }
        } catch {
          // No signal: kept for the next send.
        }
      }
    }
  } finally {
    sending = false;
  }
  if (sent) squaresChanged();
  if (games.some((g) => g.pending.size)) {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => void flushSquares(), 60_000);
  }
}

/** For tests. */
export function squaresTrackerState() {
  return games.map((g) => ({ id: g.id, mine: g.mine.size, pending: g.pending.size }));
}
