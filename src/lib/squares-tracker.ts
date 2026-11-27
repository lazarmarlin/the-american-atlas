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
 */
import type { Fix } from "@/lib/nearby";
import { inGrid, maxMphFor, maskFromText, packSquares, squareAt, squaresAlong, unpackSquares, type Grid } from "@/lib/city-grid";
import { cardDealt, squaresChanged } from "@/lib/squares-map";
import { cardById } from "@/lib/square-cards";
import type { Pauses } from "@/lib/city-squares";

/** pending: squares found but not sent yet, with when. */
type Game = { id: string; grid: Grid; maxMph: number | null; startedAt: number; mine: Set<number>; pending: Map<number, number>; pauses: Pauses; blocks: Pauses };

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
        return { id: row.id, grid, maxMph: maxMphFor(row.travel), startedAt: row.startedAt, mine, pending, pauses, blocks };
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
      if (t < game.startedAt || paused(game.pauses, t) || paused(game.blocks, t)) continue;
      const joined = prev && prev.t >= game.startedAt && !pauseBetween(game.pauses, prev.t, t) && !pauseBetween(game.blocks, prev.t, t);
      if (game.maxMph != null) {
        // Too fast for this game (driving in an on-foot game): this stretch doesn't count.
        if (!joined || !prev) continue;
        const hours = Math.max(1, t - prev.t) / 3_600_000;
        if (miles(prev, fix) / hours > game.maxMph) continue;
      }
      const squares = joined && prev ? squaresAlong(game.grid, prev, fix) : [squareAt(game.grid, fix.lat, fix.lon)];
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
          for (const [n] of run) {
            game.mine.add(n);
            game.pending.delete(n);
          }
          sent = true;
          if ("dealt" in res && res.dealt) {
            // A card: nothing more counts until it's done (wild ones are done already).
            game.blocks = [...game.blocks, [res.dealt.at, res.dealt.wild ? res.dealt.at : null]];
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
