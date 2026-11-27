/**
 * City squares on a board: picking the city, size and mode, then the card
 * (the city's squares drawn as a little map), how it's going, and skips.
 * The rules are in src/lib/city-grid.ts; the server side in
 * src/lib/city-squares.ts. Tracking fills the squares in (squares-tracker.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapIcon, Search, Trophy } from "lucide-react";
import {
  MAX_SQUARES,
  SQUARE_SIZES,
  biggestBlock,
  gridFor,
  inGrid,
  maskFromText,
  maskToText,
  pockets,
  squareMiles,
  squareRing,
  unpackSquares,
  type Grid,
} from "@/lib/city-grid";
import { setupSquares, skipSquare, squaresState, type SquaresMode, type SquaresState } from "@/lib/city-squares";
import { setSquaresOnMap, squaresChanged, useSquaresOnMap } from "@/lib/squares-map";
import { refreshSquareGames } from "@/lib/squares-tracker";
import { KIND_LOOK, Label } from "@/components/board-ui";
import { Card, Pill, type BoardApi } from "@/components/board-kinds";

const MINE = KIND_LOOK.squares.tint;
/** Other players' colors in a race. */
const OTHERS = ["#3d8fd4", "#e0a040", "#b06ad6", "#e0607a"];

type TownHit = { name: string; st: string; geoid: string; shape: GeoJSON.Polygon | GeoJSON.MultiPolygon };

/* ------------------------------------------------------------------ state */

/** Everything the card shows, worked out from the server's state. */
export function readSquares(state: SquaresState) {
  const game = state.game;
  if (!game) return null;
  const grid: Grid = { zoom: game.zoom, x0: game.x0, y0: game.y0, w: game.w, h: game.h, mask: maskFromText(game.mask), count: game.total };
  const owner = new Map<number, string>();
  for (const [id, packed] of Object.entries(state.firsts)) for (const n of unpackSquares(packed)) if (inGrid(grid, n)) owner.set(n, id);
  const skips = new Set(unpackSquares(state.skips).filter((n) => inGrid(grid, n) && !owner.has(n)));
  const walled = new Map<number, string>();
  const visited = new Set(owner.keys());
  if (game.mode === "together") {
    for (const n of pockets(grid, visited)) if (!skips.has(n)) walled.set(n, "");
  } else {
    // Each player's own walls close their own pockets.
    const order = [...state.players].sort((a, b) => (state.visits[b.id] ?? 0) - (state.visits[a.id] ?? 0));
    for (const player of order) {
      const walls = new Set([...owner].filter(([, id]) => id === player.id).map(([n]) => n));
      for (const n of pockets(grid, walls, visited)) if (!walled.has(n)) walled.set(n, player.id);
    }
  }
  const filled = new Set<number>([...visited, ...walled.keys()]);
  const done = filled.size + skips.size;
  const score = new Map<string, number>();
  for (const [, id] of owner) score.set(id, (score.get(id) ?? 0) + 1);
  if (game.mode === "race") for (const [, id] of walled) score.set(id, (score.get(id) ?? 0) + 1);
  return {
    game,
    grid,
    owner,
    walled,
    skips,
    filled,
    done,
    percent: game.total ? (done / game.total) * 100 : 0,
    block: biggestBlock(grid, filled),
    score,
  };
}

/**
 * The game's squares for the main map: each a little square with how it's
 * doing (s: "filled" | "walled" | "skip" | "empty") and its color.
 */
export function squareFeatures(state: SquaresState): GeoJSON.Feature[] | null {
  const view = readSquares(state);
  if (!view) return null;
  const { grid } = view;
  const out: GeoJSON.Feature[] = [];
  for (let i = 0; i < grid.w * grid.h; i++) {
    if (!inGrid(grid, i)) continue;
    const who = view.owner.get(i);
    const wall = view.walled.get(i);
    const s = who != null ? "filled" : wall != null ? "walled" : view.skips.has(i) ? "skip" : "empty";
    const c = who != null ? colorFor(state, who) : wall != null ? colorFor(state, wall || state.me) : "#8a857a";
    out.push({ type: "Feature", properties: { s, c }, geometry: { type: "Polygon", coordinates: [squareRing(grid, i)] } });
  }
  return out;
}

/* ------------------------------------------------------------------ setup */

function SquaresSetup({ api, onStarted }: { api: BoardApi; onStarted: () => void }) {
  const [towns, setTowns] = useState<TownHit[] | null>(null);
  const [q, setQ] = useState("");
  const [town, setTown] = useState<TownHit | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [mode, setMode] = useState<SquaresMode>("together");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const owner = api.board.role === "owner";

  useEffect(() => {
    if (!owner) return;
    let live = true;
    void import("@/lib/towns-overlay")
      .then((mod) => mod.loadTowns())
      .then((fc) => live && setTowns(fc.features.map((f) => ({ name: f.properties.name, st: f.properties.st, geoid: f.properties.geoid, shape: f.geometry }))))
      .catch(() => live && setNote("Couldn't load the list of cities. Check your connection."));
    return () => {
      live = false;
    };
  }, [owner]);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!towns || term.length < 2) return [];
    const [name, st] = term.split(",").map((part) => part.trim());
    const out = towns.filter((t) => t.name.toLowerCase().startsWith(name) && (!st || t.st.toLowerCase().startsWith(st)));
    out.sort((a, b) => Number(b.name.toLowerCase() === name) - Number(a.name.toLowerCase() === name) || a.name.length - b.name.length);
    return out.slice(0, 8);
  }, [towns, q]);

  const sizes = useMemo(() => {
    if (!town) return [];
    return SQUARE_SIZES.map((size) => ({ ...size, grid: gridFor(town.shape, size.zoom) }));
  }, [town]);

  useEffect(() => {
    if (!sizes.length) return;
    // Start on the smallest size that's a playable count.
    const pick = sizes.find((s) => s.grid.count >= 1 && s.grid.count <= 3000) ?? sizes.find((s) => s.grid.count >= 1 && s.grid.count <= MAX_SQUARES);
    setZoom(pick?.zoom ?? null);
  }, [sizes]);

  if (!owner) {
    return (
      <Card>
        <p className="text-sm text-muted">Waiting for {api.name(api.people[0]?.id)} to pick the city.</p>
      </Card>
    );
  }

  const chosen = sizes.find((s) => s.zoom === zoom);
  const lat = (() => {
    const ring = town ? (town.shape.type === "Polygon" ? town.shape.coordinates[0] : town.shape.coordinates[0]?.[0]) : null;
    return ring?.[0]?.[1] ?? 39;
  })();

  async function start() {
    if (!town || !chosen) return;
    setBusy(true);
    setNote(null);
    try {
      const g = chosen.grid;
      await setupSquares({ data: { id: api.board.id, geoid: town.geoid, city: town.name, state: town.st, zoom: g.zoom, mode, x0: g.x0, y0: g.y0, w: g.w, h: g.h, mask: maskToText(g.mask) } });
      onStarted();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't start the game.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <Label>Pick a city</Label>
        {town ? (
          <div className="mt-2 flex items-center gap-2">
            <p className="min-w-0 flex-1 font-serif text-2xl leading-tight">
              {town.name}, {town.st}
            </p>
            <button type="button" onClick={() => setTown(null)} className="text-sm text-muted">
              Change
            </button>
          </div>
        ) : (
          <>
            <div className="mt-2 flex h-11 items-center gap-2 rounded-lg border border-line bg-bg px-3">
              <Search className="size-4 shrink-0 text-faint" aria-hidden />
              <input value={q} onChange={(event) => setQ(event.target.value)} placeholder={towns ? "City or town (Columbus, OH)" : "Loading cities…"} disabled={!towns} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint" aria-label="City or town" />
            </div>
            {hits.length ? (
              <ul className="mt-2 overflow-hidden rounded-xl border border-line">
                {hits.map((hit) => (
                  <li key={hit.geoid} className="border-b border-line last:border-b-0">
                    <button type="button" onClick={() => setTown(hit)} className="flex h-11 w-full items-center px-3 text-left text-[15px] active:bg-elevated">
                      {hit.name}, {hit.st}
                    </button>
                  </li>
                ))}
              </ul>
            ) : q.trim().length >= 2 && towns ? (
              <p className="mt-2 text-sm text-muted">No city or town by that name.</p>
            ) : null}
          </>
        )}
      </Card>
      {town ? (
        <>
          <Card>
            <Label>Square size</Label>
            <div className="mt-2 grid gap-1.5">
              {sizes.map((size) => {
                const tooMany = size.grid.count > MAX_SQUARES;
                const none = size.grid.count < 1;
                return (
                  <button
                    key={size.id}
                    type="button"
                    disabled={tooMany || none}
                    aria-pressed={zoom === size.zoom}
                    onClick={() => setZoom(size.zoom)}
                    className={"flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-left disabled:opacity-45 " + (zoom === size.zoom ? "border-ink bg-elevated" : "border-line")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px]">
                        {size.name} <span className="text-muted">· {size.line}</span>
                      </span>
                      <span className="block text-xs text-faint">{squareMiles(size.zoom, lat).toFixed(2)} mi across</span>
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums">{tooMany ? "Too many" : none ? "None" : `${size.grid.count.toLocaleString()} squares`}</span>
                  </button>
                );
              })}
            </div>
          </Card>
          <Card>
            <Label>With friends</Label>
            <div className="mt-2 grid grid-cols-2 rounded-xl bg-bg/60 p-1">
              {(
                [
                  ["together", "Together"],
                  ["race", "Race"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)} className={"h-10 rounded-lg text-sm " + (mode === id ? "bg-elevated text-ink shadow-sm" : "text-muted")}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-faint">
              {mode === "together"
                ? "One card. Everyone's squares fill it in, and a few skips for places nobody can get into."
                : "Each square goes to whoever gets there first. Most squares when the city's done wins."}{" "}
              Share the board to play with friends. Only trips from now on count.
            </p>
          </Card>
          <div className="mx-4 mt-4">
            <button type="button" disabled={!chosen || busy} onClick={() => void start()} className="h-12 w-full rounded-lg bg-ink text-[15px] text-bg disabled:bg-elevated disabled:text-faint">
              {busy ? "Starting…" : chosen ? `Start · ${chosen.grid.count.toLocaleString()} squares` : "Pick a size"}
            </button>
            {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
          </div>
        </>
      ) : note ? (
        <p className="mx-4 mt-3 text-sm text-muted">{note}</p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------- card */

function colorFor(state: SquaresState, id: string) {
  if (id === state.me || state.game?.mode === "together") return MINE;
  const others = state.players.filter((p) => p.id !== state.me);
  return OTHERS[Math.max(0, others.findIndex((p) => p.id === id)) % OTHERS.length];
}

/** The city's squares, drawn small. Tap one for what's there. */
function SquaresCanvas({ state, view, picked, onPick }: { state: SquaresState; view: NonNullable<ReturnType<typeof readSquares>>; picked: number | null; onPick: (square: number | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(320);
  const { grid } = view;
  const cell = Math.max(1, Math.min(18, Math.min(width / grid.w, 420 / grid.h)));
  const cw = Math.round(grid.w * cell);
  const ch = Math.round(grid.h * cell);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const size = () => setWidth(el.clientWidth);
    size();
    const watch = new ResizeObserver(size);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(cw * ratio);
    canvas.height = Math.round(ch * ratio);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const styles = getComputedStyle(canvas);
    const empty = styles.getPropertyValue("--color-line").trim() || "#3a372f";
    const gap = cell >= 4 ? Math.max(0.5, cell * 0.12) : 0;
    for (let i = 0; i < grid.w * grid.h; i++) {
      if (!inGrid(grid, i)) continue;
      const x = (i % grid.w) * cell;
      const y = Math.floor(i / grid.w) * cell;
      const who = view.owner.get(i);
      const wall = view.walled.get(i);
      g.globalAlpha = 1;
      if (who != null) g.fillStyle = colorFor(state, who);
      else if (wall != null) {
        g.fillStyle = colorFor(state, wall || state.me);
        g.globalAlpha = 0.55;
      } else if (view.skips.has(i)) {
        g.fillStyle = "#8a857a";
        g.globalAlpha = 0.5;
      } else g.fillStyle = empty;
      g.fillRect(x + gap / 2, y + gap / 2, cell - gap, cell - gap);
    }
    if (picked != null && inGrid(grid, picked)) {
      g.globalAlpha = 1;
      g.strokeStyle = styles.getPropertyValue("--color-ink").trim() || "#f3f0e6";
      g.lineWidth = 2;
      g.strokeRect((picked % grid.w) * cell - 1, Math.floor(picked / grid.w) * cell - 1, cell + 2, cell + 2);
    }
  }, [state, view, grid, cell, cw, ch, picked]);

  return (
    <div ref={wrap} className="mt-3 flex justify-center">
      <canvas
        ref={ref}
        style={{ width: cw, height: ch, touchAction: "manipulation" }}
        aria-label={`The city's ${grid.count} squares, ${view.done} filled`}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const x = Math.floor((event.clientX - box.left) / cell);
          const y = Math.floor((event.clientY - box.top) / cell);
          const index = x + y * grid.w;
          onPick(x >= 0 && y >= 0 && x < grid.w && y < grid.h && inGrid(grid, index) ? index : null);
        }}
      />
    </div>
  );
}

export function SquaresBoard({ api }: { api: BoardApi }) {
  const [state, setState] = useState<SquaresState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const onMap = useSquaresOnMap((s) => s.id === api.board.id);
  const id = api.board.id;

  const load = useRef<() => Promise<void>>(async () => undefined);
  load.current = async () => {
    try {
      setState(await squaresState({ data: { id } }));
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't load the game.");
    }
  };
  useEffect(() => {
    void load.current();
    // A game shared with you since the app last looked: tracking learns about it now.
    void refreshSquareGames(true);
    // While it's open: friends' squares come in.
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load.current(), 15_000);
    return () => window.clearInterval(timer);
  }, [id]);

  const view = useMemo(() => (state ? readSquares(state) : null), [state]);

  if (!state) return <p className="mx-4 mt-5 text-sm text-muted">{note ?? "Loading…"}</p>;
  if (!view)
    return (
      <SquaresSetup
        api={api}
        onStarted={() => {
          void load.current().then(() => setSquaresOnMap(id));
          // Tracking starts filling it in straight away.
          void refreshSquareGames(true);
        }}
      />
    );

  const { game } = view;
  const race = game.mode === "race";
  const skipsLeft = state.skipsAllowed - view.skips.size;
  const ranked = [...state.players].map((p) => ({ ...p, score: view.score.get(p.id) ?? 0 })).sort((a, b) => b.score - a.score);
  const complete = view.done >= game.total;
  const pickedOwner = picked != null ? view.owner.get(picked) : undefined;
  const pickedWall = picked != null ? view.walled.get(picked) : undefined;
  const nameOf = (pid: string) => (pid === state.me ? "You" : state.players.find((p) => p.id === pid)?.name ?? "Friend");

  async function skip(on: boolean) {
    if (picked == null) return;
    try {
      await skipSquare({ data: { id, square: picked, on } });
      await load.current();
      squaresChanged();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't skip that one.");
    }
  }

  return (
    <>
      {complete ? (
        <div className="mx-4 mt-4 rounded-2xl p-4 text-center text-bg" style={{ background: MINE }}>
          <p className="font-serif text-3xl leading-tight">City complete!</p>
          <p className="text-sm">
            Every square of {game.city}
            {race && ranked[0] ? ` · ${ranked[0].id === state.me ? "you win" : `${ranked[0].name} wins`}` : ""}.
          </p>
        </div>
      ) : null}
      <Card>
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-serif text-3xl leading-tight tabular-nums">{view.percent < 10 && view.percent > 0 ? view.percent.toFixed(1) : Math.floor(view.percent)}%</p>
          <span className="text-xs text-faint">
            {game.city}, {game.state} · {race ? "race" : "together"}
          </span>
        </div>
        <p className="text-sm text-muted">
          {view.done.toLocaleString()} of {game.total.toLocaleString()} squares
          {view.block >= 2 ? ` · biggest block ${view.block}×${view.block}` : ""}
        </p>
        <SquaresCanvas state={state} view={view} picked={picked} onPick={setPicked} />
        {picked != null ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-bg/60 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              {pickedOwner != null
                ? race
                  ? `${nameOf(pickedOwner)} got here first.`
                  : `${nameOf(pickedOwner)} got here.`
                : pickedWall != null
                  ? "Walled in, so it counts."
                  : view.skips.has(picked)
                    ? "Skipped: nobody can get in."
                    : "Not yet."}
            </span>
            {!race && view.skips.has(picked) ? (
              <button type="button" onClick={() => void skip(false)} className="h-8 shrink-0 rounded-full border border-line px-3 text-xs">
                Unskip
              </button>
            ) : !race && pickedOwner == null && pickedWall == null && skipsLeft > 0 ? (
              <button type="button" onClick={() => void skip(true)} className="h-8 shrink-0 rounded-full border border-line px-3 text-xs">
                Can't get in · skip
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill on={onMap} onClick={() => setSquaresOnMap(onMap ? null : id)}>
            <span className="inline-flex items-center gap-1.5">
              <MapIcon className="size-4" aria-hidden />
              {onMap ? "On the map" : "Show on the map"}
            </span>
          </Pill>
          {!race ? <span className="text-xs text-faint">{skipsLeft} {skipsLeft === 1 ? "skip" : "skips"} left</span> : null}
        </div>
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
      </Card>
      <Card>
        <Label>{race ? "The race" : "Who's filled what"}</Label>
        <ul className="mt-2 grid gap-1.5">
          {ranked.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="size-3 shrink-0 rounded-sm" style={{ background: colorFor(state, p.id) }} aria-hidden />
              <span className={"min-w-0 flex-1 truncate " + (p.id === state.me ? "font-medium" : "")}>{nameOf(p.id)}</span>
              {race && i === 0 && p.score > 0 ? <Trophy className="size-4" style={{ color: MINE }} aria-label="In the lead" /> : null}
              <span className="tabular-nums">
                {p.score.toLocaleString()} <span className="text-xs text-faint">squares</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-faint">
          Squares fill in when tracking takes you through them, from {new Date(game.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} on. Wall in a pocket of up to 4 squares (a big property, say) and it fills in too; circling a bigger area doesn't count.
        </p>
      </Card>
    </>
  );
}
