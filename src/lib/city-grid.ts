/**
 * City squares: the grid a city is cut into, and the rules of the game.
 *
 * The squares are the map's own tiles (Web Mercator) at one zoom, so every
 * player's squares line up exactly and nothing about the grid has to be
 * stored but the zoom: tiny = zoom 18 (about a block, ~0.07 mi), small = 17
 * (~0.15 mi), big = 16 (~0.3 mi). A city's squares are the tiles whose middle
 * is inside its outline (the Census outline in public/atlas/overlays/towns.json).
 *
 * A grid is kept as its box of tiles (x0, y0, w, h) and a bit mask of which
 * tiles in the box are in the city; a square is named by its index in the box,
 * (x - x0) + (y - y0) * w.
 *
 * The private-property rule: a pocket of squares nobody visited, walled in on
 * all sides by squares you did (walls may touch corner to corner; the pocket
 * can't leak out through a corner), counts as filled if it's at most
 * POCKET_MAX squares. Circling the whole city walls in one huge pocket, so
 * nothing fills. Pockets against the city's edge never close.
 */
import type { MultiPolygon, Polygon, Position } from "geojson";

export const SQUARE_SIZES = [
  { id: "tiny", zoom: 18, name: "Tiny", line: "about a block" },
  { id: "small", zoom: 17, name: "Small", line: "about 2 blocks" },
  { id: "big", zoom: 16, name: "Big", line: "about 4 blocks" },
] as const;
export type SquareSize = (typeof SQUARE_SIZES)[number]["id"];

/** How a game is played, and the fastest a stretch of travel can be and still count. */
export const TRAVEL_MODES = [
  { id: "foot", name: "On foot", line: "Walking or running", maxMph: 12 },
  { id: "bike", name: "Bike", line: "Up to 25 mph", maxMph: 25 },
  { id: "car", name: "Car", line: "Any speed", maxMph: null },
] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number]["id"];

export function maxMphFor(travel: string): number | null {
  return TRAVEL_MODES.find((mode) => mode.id === travel)?.maxMph ?? null;
}

/** Walled-in pockets this size or smaller fill in by themselves. */
export const POCKET_MAX = 4;
/** More squares than this is no game (a big city at the tiny size). */
export const MAX_SQUARES = 30_000;
/** Skips (squares nobody can get into): one for every this many squares. */
export const SQUARES_PER_SKIP = 50;

export type Grid = { zoom: number; x0: number; y0: number; w: number; h: number; mask: Uint8Array; count: number };

/* ------------------------------------------------------------ tile math */

export function tileX(lon: number, zoom: number) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

export function tileY(lat: number, zoom: number) {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** zoom;
}

export function lonOf(x: number, zoom: number) {
  return (x / 2 ** zoom) * 360 - 180;
}

export function latOf(y: number, zoom: number) {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** zoom))) * 180) / Math.PI;
}

/** Roughly how wide a square is on the ground, in miles. */
export function squareMiles(zoom: number, lat: number) {
  return ((40_075_016 / 2 ** zoom) * Math.cos((lat * Math.PI) / 180)) / 1609.34;
}

/* --------------------------------------------------------------- grids */

function polygonsOf(shape: Polygon | MultiPolygon): Position[][][] {
  return shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates;
}

/** The squares of a city at a zoom: tiles whose middle is inside the outline (holes and islands included). */
export function gridFor(shape: Polygon | MultiPolygon, zoom: number): Grid {
  const rings = polygonsOf(shape).flat();
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  const x0 = Math.floor(tileX(west, zoom));
  const x1 = Math.floor(tileX(east, zoom));
  const y0 = Math.floor(tileY(north, zoom));
  const y1 = Math.floor(tileY(south, zoom));
  const w = Math.max(1, x1 - x0 + 1);
  const h = Math.max(1, y1 - y0 + 1);
  const mask = new Uint8Array(Math.ceil((w * h) / 8));
  let count = 0;
  // One row at a time: where the row's middle line crosses the outline, inside is between pairs of crossings.
  const crossings: number[] = [];
  for (let row = 0; row < h; row++) {
    const lat = latOf(y0 + row + 0.5, zoom);
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[j];
        const [bx, by] = ring[i];
        if (ay > lat !== by > lat) crossings.push(ax + ((lat - ay) * (bx - ax)) / (by - ay));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.ceil(tileX(crossings[k], zoom) - 0.5);
      const to = Math.floor(tileX(crossings[k + 1], zoom) - 0.5);
      for (let x = Math.max(from, x0); x <= Math.min(to, x1); x++) {
        const index = x - x0 + row * w;
        if (!(mask[index >> 3] & (1 << (index & 7)))) {
          mask[index >> 3] |= 1 << (index & 7);
          count++;
        }
      }
    }
  }
  return { zoom, x0, y0, w, h, mask, count };
}

export function inGrid(grid: Grid, index: number) {
  return index >= 0 && index < grid.w * grid.h && (grid.mask[index >> 3] & (1 << (index & 7))) !== 0;
}

/** The square a point is in, or -1 if that's not one of the city's. */
export function squareAt(grid: Grid, lat: number, lon: number) {
  const x = Math.floor(tileX(lon, grid.zoom)) - grid.x0;
  const y = Math.floor(tileY(lat, grid.zoom)) - grid.y0;
  if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return -1;
  const index = x + y * grid.w;
  return inGrid(grid, index) ? index : -1;
}

/** Every one of the city's squares a straight stretch of travel passes through (not just the ends). */
export function squaresAlong(grid: Grid, a: { lat: number; lon: number }, b: { lat: number; lon: number }): number[] {
  const z = grid.zoom;
  const ax = tileX(a.lon, z) - grid.x0;
  const ay = tileY(a.lat, z) - grid.y0;
  const bx = tileX(b.lon, z) - grid.x0;
  const by = tileY(b.lat, z) - grid.y0;
  const out: number[] = [];
  let x = Math.floor(ax);
  let y = Math.floor(ay);
  const ex = Math.floor(bx);
  const ey = Math.floor(by);
  const dx = bx - ax;
  const dy = by - ay;
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const tdx = dx === 0 ? Infinity : Math.abs(1 / dx);
  const tdy = dy === 0 ? Infinity : Math.abs(1 / dy);
  let tx = dx === 0 ? Infinity : (sx > 0 ? x + 1 - ax : ax - x) * tdx;
  let ty = dy === 0 ? Infinity : (sy > 0 ? y + 1 - ay : ay - y) * tdy;
  const push = () => {
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return;
    const index = x + y * grid.w;
    if (inGrid(grid, index)) out.push(index);
  };
  push();
  for (let guard = 0; (x !== ex || y !== ey) && guard < 20_000; guard++) {
    if (tx < ty) {
      tx += tdx;
      x += sx;
    } else {
      ty += tdy;
      y += sy;
    }
    push();
  }
  return out;
}

/* ---------------------------------------------------------------- rules */

/**
 * The pockets that fill in for whoever's walls these are: squares that
 * aren't `walls`, walled in on every side (moving side to side only, so a
 * corner-to-corner wall still closes), not touching the city's edge, and at
 * most POCKET_MAX squares. Returns the pocket squares that aren't `taken`
 * (in a race, squares the other player already has stay theirs).
 */
export function pockets(grid: Grid, walls: Set<number>, taken: Set<number> = walls, max = POCKET_MAX): number[] {
  const { w, h } = grid;
  const seen = new Uint8Array(w * h);
  const out: number[] = [];
  const queue: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !inGrid(grid, start) || walls.has(start)) continue;
    // One pocket: everything reachable from here without crossing a wall.
    queue.length = 0;
    queue.push(start);
    seen[start] = 1;
    let open = false;
    const members: number[] = [];
    for (let q = 0; q < queue.length; q++) {
      const at = queue[q];
      members.push(at);
      const x = at % w;
      const y = (at - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          open = true;
          continue;
        }
        const next = nx + ny * w;
        if (!inGrid(grid, next)) {
          open = true; // the city's edge (or a hole in it)
          continue;
        }
        if (walls.has(next) || seen[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    if (!open && members.length <= max) for (const m of members) if (!taken.has(m)) out.push(m);
  }
  return out;
}

/** The biggest solid block of filled squares, as its side (7 = 7×7). */
export function biggestBlock(grid: Grid, filled: Set<number>) {
  const { w, h } = grid;
  let best = 0;
  let prev = new Uint16Array(w);
  let cur = new Uint16Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = x + y * w;
      if (!filled.has(index)) {
        cur[x] = 0;
        continue;
      }
      cur[x] = x === 0 || y === 0 ? 1 : Math.min(prev[x], cur[x - 1], prev[x - 1]) + 1;
      if (cur[x] > best) best = cur[x];
    }
    [prev, cur] = [cur, prev];
  }
  return best;
}

/** Skips a city allows (squares nobody can get into, like an airfield or a lake). */
export function skipsFor(count: number) {
  return Math.max(1, Math.floor(count / SQUARES_PER_SKIP));
}

/* ------------------------------------------------------------ transport */

export function maskToText(mask: Uint8Array) {
  let bin = "";
  for (let i = 0; i < mask.length; i++) bin += String.fromCharCode(mask[i]);
  return btoa(bin);
}

export function maskFromText(text: string) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Square indexes as text: sorted, each as the gap from the one before, base 36. */
export function packSquares(indexes: Iterable<number>) {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  let last = 0;
  return sorted
    .map((n) => {
      const gap = n - last;
      last = n;
      return gap.toString(36);
    })
    .join(".");
}

export function unpackSquares(text: string): number[] {
  if (!text) return [];
  let last = 0;
  return text.split(".").map((part) => (last += parseInt(part, 36)));
}

/** A square's corners, for drawing it on the map. */
export function squareRing(grid: Grid, index: number): Position[] {
  const x = (index % grid.w) + grid.x0;
  const y = Math.floor(index / grid.w) + grid.y0;
  const w = lonOf(x, grid.zoom);
  const e = lonOf(x + 1, grid.zoom);
  const n = latOf(y, grid.zoom);
  const s = latOf(y + 1, grid.zoom);
  return [[w, n], [e, n], [e, s], [w, s], [w, n]];
}

/* ---------------------------------------------------------- Hard mode and grid cards */

/** In a Hard game, walled-in pockets fill only up to this size. */
export const POCKET_MAX_HARD = 2;
/** In a Hard game, a square counts only after this long in it (passing through doesn't). */
export const DWELL_MS = 20_000;

/** The squares next to one (up, down, left, right) that are the area's. */
export function neighbors(grid: Grid, index: number): number[] {
  const x = index % grid.w;
  const y = (index - x) / grid.w;
  const out: number[] = [];
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
    if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
    const n = nx + ny * grid.w;
    if (inGrid(grid, n)) out.push(n);
  }
  return out;
}

/** The biggest connected patch of squares (touching side to side), as a count: the score in a Hard race. */
export function biggestPatch(grid: Grid, squares: Set<number>) {
  const seen = new Set<number>();
  let best = 0;
  for (const start of squares) {
    if (seen.has(start)) continue;
    let size = 0;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const at = queue.pop() as number;
      size++;
      for (const n of neighbors(grid, at)) {
        if (!squares.has(n) || seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    if (size > best) best = size;
  }
  return best;
}

/** Which of `fresh` may count when new squares have to touch ones you have (`have`). Grows outward, so a connected run in one go all counts. */
export function touching(grid: Grid, have: Set<number>, fresh: number[]): number[] {
  const kept: number[] = [];
  const own = new Set(have);
  let left = fresh.filter((n) => !own.has(n));
  // Nothing yet: the first square is free.
  if (!own.size && left.length) {
    own.add(left[0]);
    kept.push(left[0]);
    left = left.slice(1);
  }
  let grew = true;
  while (grew && left.length) {
    grew = false;
    const next: number[] = [];
    for (const n of left) {
      if (neighbors(grid, n).some((m) => own.has(m))) {
        own.add(n);
        kept.push(n);
        grew = true;
      } else next.push(n);
    }
    left = next;
  }
  return kept;
}

/** Every square of the area, for picking from. */
function allSquares(grid: Grid) {
  const out: number[] = [];
  for (let i = 0; i < grid.w * grid.h; i++) if (inGrid(grid, i)) out.push(i);
  return out;
}

const xy = (grid: Grid, i: number) => [i % grid.w, Math.floor(i / grid.w)] as const;

/** The four corner squares (the area's square nearest each corner of its box): NE, NW, SE, SW. */
export function cornerSquares(grid: Grid): number[] {
  const all = allSquares(grid);
  const corners: [number, number][] = [[grid.w - 1, 0], [0, 0], [grid.w - 1, grid.h - 1], [0, grid.h - 1]];
  return corners.map(([cx, cy]) => {
    let best = all[0];
    let d = Infinity;
    for (const i of all) {
      const [x, y] = xy(grid, i);
      const dd = (x - cx) ** 2 + (y - cy) ** 2;
      if (dd < d) {
        d = dd;
        best = i;
      }
    }
    return best;
  });
}

export const CORNER_NAMES = ["Northeast", "Northwest", "Southeast", "Southwest"];

/** The square nearest the middle of the area. */
export function middleSquare(grid: Grid): number {
  const all = allSquares(grid);
  let sx = 0;
  let sy = 0;
  for (const i of all) {
    const [x, y] = xy(grid, i);
    sx += x;
    sy += y;
  }
  const mx = sx / all.length;
  const my = sy / all.length;
  let best = all[0];
  let d = Infinity;
  for (const i of all) {
    const [x, y] = xy(grid, i);
    const dd = (x - mx) ** 2 + (y - my) ** 2;
    if (dd < d) {
      d = dd;
      best = i;
    }
  }
  return best;
}

/** Squares on the area's outline (one side touches the outside). */
export function edgeSquares(grid: Grid): number[] {
  return allSquares(grid).filter((i) => neighbors(grid, i).length < 4);
}

/** The empty square farthest from `from`. */
export function farSquare(grid: Grid, from: number, visited: Set<number>): number | null {
  const [fx, fy] = xy(grid, from);
  let best: number | null = null;
  let d = -1;
  for (const i of allSquares(grid)) {
    if (visited.has(i)) continue;
    const [x, y] = xy(grid, i);
    const dd = (x - fx) ** 2 + (y - fy) ** 2;
    if (dd > d) {
      d = dd;
      best = i;
    }
  }
  return best;
}

/** Empty squares with yours on at least three sides. */
export function holeSquares(grid: Grid, mine: Set<number>, visited: Set<number>): number[] {
  return allSquares(grid).filter((i) => !visited.has(i) && neighbors(grid, i).filter((n) => mine.has(n)).length >= 3);
}

/** Whether these squares, in order, are a straight run: each next to the one before, all in one row or column. */
export function straightRun(grid: Grid, run: number[]) {
  if (run.length < 2) return false;
  const rows = new Set(run.map((i) => xy(grid, i)[1]));
  const cols = new Set(run.map((i) => xy(grid, i)[0]));
  if (rows.size !== 1 && cols.size !== 1) return false;
  if (new Set(run).size !== run.length) return false;
  for (let k = 1; k < run.length; k++) if (!neighbors(grid, run[k]).includes(run[k - 1])) return false;
  return true;
}

/** A square's middle, [lat, lon]. */
export function squareCenter(grid: Grid, index: number): [number, number] {
  const [x, y] = xy(grid, index);
  return [latOf(grid.y0 + y + 0.5, grid.zoom), lonOf(grid.x0 + x + 0.5, grid.zoom)];
}

/** Today's squares: a handful picked fresh each day (the same for everyone), from the ones nobody had by the start of the day. */
export function todaysSquares(grid: Grid, seed: string, takenBefore: Set<number>, count = 5): number[] {
  let h = 2166136261;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const pool = allSquares(grid).filter((i) => !takenBefore.has(i));
  const out: number[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}
