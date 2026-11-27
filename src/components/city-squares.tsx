/**
 * City squares on a board: picking the city, size and mode, then the card
 * (the city's squares drawn as a little map), how it's going, and skips.
 * The rules are in src/lib/city-grid.ts; the server side in
 * src/lib/city-squares.ts. Tracking fills the squares in (squares-tracker.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Map as MapIcon, Pause, Play, Search, Trophy } from "lucide-react";
import {
  MAX_SQUARES,
  SQUARE_SIZES,
  TRAVEL_MODES,
  type TravelMode,
  biggestBlock,
  gridFor,
  inGrid,
  maskFromText,
  maskToText,
  pockets,
  squareAt,
  squareMiles,
  squareRing,
  unpackSquares,
  type Grid,
} from "@/lib/city-grid";
import { pauseSquares, playCard, setupSquares, skipSquare, squaresState, swapCard, type SquaresMode, type SquaresPlace, type SquaresState } from "@/lib/city-squares";
import { cardFinished, setSquaresOnMap, squaresChanged, useSquaresOnMap } from "@/lib/squares-map";
import { refreshSquareGames } from "@/lib/squares-tracker";
import { KIND_LOOK, Label } from "@/components/board-ui";
import { SquareCardArt } from "@/components/square-card-art";
import { CARD_EVERY, DECK_MAX, SQUARE_CARDS, cardById, dealable, type Deck } from "@/lib/square-cards";
import { lastSquaresFix } from "@/lib/squares-tracker";
import { Card, Pill, type BoardApi } from "@/components/board-kinds";

const MINE = KIND_LOOK.squares.tint;
/** Other players' colors in a race. */
const OTHERS = ["#3d8fd4", "#e0a040", "#b06ad6", "#e0607a"];

type TownHit = { name: string; st: string; geoid: string; shape: GeoJSON.Polygon | GeoJSON.MultiPolygon };

const PLACES: { id: SquaresPlace; label: string; search: string }[] = [
  { id: "city", label: "City", search: "City or town (Columbus, OH)" },
  { id: "county", label: "County", search: "County (Franklin, OH)" },
  { id: "state", label: "State park", search: "State park name" },
  { id: "national", label: "National park", search: "National park name" },
];

/** The places of a kind, with their outlines: cities from the town outlines, parks from the park outlines. */
async function loadPlaces(kind: SquaresPlace): Promise<TownHit[]> {
  if (kind === "city") {
    const fc = await (await import("@/lib/towns-overlay")).loadTowns();
    return fc.features.map((f) => ({ name: f.properties.name, st: f.properties.st, geoid: f.properties.geoid, shape: f.geometry }));
  }
  if (kind === "county") {
    const res = await fetch("/atlas/counties.geojson");
    if (!res.ok) throw new Error(`counties: ${res.status}`);
    const fc = (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { id: string; name: string; st: string }>;
    return fc.features.map((f) => ({ name: f.properties.name, st: f.properties.st, geoid: f.properties.id, shape: f.geometry }));
  }
  const res = await fetch("/atlas/overlays/parks.geojson");
  if (!res.ok) throw new Error(`parks: ${res.status}`);
  const fc = (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { id: string; name: string; st: string; level: string }>;
  return fc.features
    .filter((f) => f.properties.level === kind && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
    .map((f) => ({ name: f.properties.name, st: f.properties.st, geoid: f.properties.id, shape: f.geometry }));
}

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
  // Where your card can send you.
  for (const [, name, lat, lon] of state.holding[state.me]?.targets ?? []) out.push({ type: "Feature", properties: { s: "target", c: MINE, name }, geometry: { type: "Point", coordinates: [lon, lat] } });
  return out;
}

/** For each "go to" card, the state's places of its kinds inside the grid (spread out past DECK_MAX). */
async function buildDeck(st: string, grid: Grid): Promise<Deck> {
  const res = await fetch(`/atlas/places/${st}.json`);
  if (!res.ok) return {};
  const file = (await res.json()) as Record<string, { id: string; name: string; lat: number; lon: number }[]>;
  const deck: Deck = {};
  for (const card of SQUARE_CARDS) {
    if (!card.cats) continue;
    const seen = new Set<string>();
    let list: [string, string, number, number][] = [];
    for (const cat of card.cats)
      for (const p of file[cat] ?? []) {
        if (seen.has(p.id) || !Number.isFinite(p.lat) || squareAt(grid, p.lat, p.lon) < 0) continue;
        seen.add(p.id);
        list.push([p.id, p.name, p.lat, p.lon]);
      }
    if (list.length > DECK_MAX) {
      const step = list.length / DECK_MAX;
      list = Array.from({ length: DECK_MAX }, (_, i) => list[Math.floor(i * step)]);
    }
    deck[card.id] = list;
  }
  return deck;
}

/* ------------------------------------------------------------------ setup */

function SquaresSetup({ api, onStarted }: { api: BoardApi; onStarted: () => void }) {
  const [kind, setKind] = useState<SquaresPlace>("city");
  const [towns, setTowns] = useState<TownHit[] | null>(null);
  const [q, setQ] = useState("");
  const [town, setTown] = useState<TownHit | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [mode, setMode] = useState<SquaresMode>("together");
  const [travel, setTravel] = useState<TravelMode>("car");
  const [cards, setCards] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const owner = api.board.role === "owner";

  useEffect(() => {
    if (!owner) return;
    let live = true;
    setTowns(null);
    setTown(null);
    setNote(null);
    // Cities and counties are usually driven; parks walked.
    setTravel(kind === "city" || kind === "county" ? "car" : "foot");
    void loadPlaces(kind)
      .then((list) => live && setTowns(list))
      .catch(() => live && setNote("Couldn't load the list. Check your connection."));
    return () => {
      live = false;
    };
  }, [owner, kind]);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!towns || term.length < 2) return [];
    const [name, st] = term.split(",").map((part) => part.trim());
    // Cities by how their name starts; parks by any word ("smoky" finds Great Smoky Mountains).
    const match = (t: TownHit) => (kind === "city" || kind === "county" ? t.name.toLowerCase().startsWith(name) : t.name.toLowerCase().includes(name));
    const out = towns.filter((t) => match(t) && (!st || t.st.toLowerCase().startsWith(st)));
    out.sort((a, b) => Number(b.name.toLowerCase() === name) - Number(a.name.toLowerCase() === name) || a.name.length - b.name.length);
    return out.slice(0, 8);
  }, [towns, q, kind]);

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

  const chosen = sizes.find((s) => s.zoom === zoom);
  // Where the cards can send you: the state's places of each card's kinds inside the area.
  const [deck, setDeck] = useState<Deck | null>(null);
  useEffect(() => {
    setDeck(null);
    if (!town || !chosen || !cards) return;
    let live = true;
    void buildDeck(town.st, chosen.grid)
      .then((d) => live && setDeck(d))
      .catch(() => live && setDeck({}));
    return () => {
      live = false;
    };
  }, [town, chosen, cards]);
  if (!owner) {
    return (
      <Card>
        <p className="text-sm text-muted">Waiting for {api.name(api.people[0]?.id)} to pick the place.</p>
      </Card>
    );
  }

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
      const d = cards ? (deck ?? (await buildDeck(town.st, g).catch(() => ({})))) : null;
      await setupSquares({ data: { id: api.board.id, geoid: town.geoid, city: town.name, place: kind, travel, cards, deck: d, state: town.st, zoom: g.zoom, mode, x0: g.x0, y0: g.y0, w: g.w, h: g.h, mask: maskToText(g.mask) } });
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
        <div className="grid grid-cols-4 rounded-xl bg-bg/60 p-1">
          {PLACES.map((p) => (
            <button key={p.id} type="button" aria-pressed={kind === p.id} onClick={() => setKind(p.id)} className={"min-h-10 rounded-lg px-1 text-[13px] leading-tight " + (kind === p.id ? "bg-elevated text-ink shadow-sm" : "text-muted")}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <Label>{kind === "city" ? "Pick a city" : kind === "county" ? "Pick a county" : kind === "state" ? "Pick a state park" : "Pick a national park"}</Label>
        </div>
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
              <input value={q} onChange={(event) => setQ(event.target.value)} placeholder={towns ? PLACES.find((p) => p.id === kind)?.search : "Loading…"} disabled={!towns} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint" aria-label={kind === "city" ? "City or town" : kind === "county" ? "County" : "Park name"} />
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
              <p className="mt-2 text-sm text-muted">{kind === "city" ? "No city or town by that name." : kind === "county" ? "No county by that name." : "No park by that name."}</p>
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
            <Label>Getting around</Label>
            <div className="mt-2 grid grid-cols-3 rounded-xl bg-bg/60 p-1">
              {TRAVEL_MODES.map((t) => (
                <button key={t.id} type="button" aria-pressed={travel === t.id} onClick={() => setTravel(t.id)} className={"h-10 rounded-lg text-sm " + (travel === t.id ? "bg-elevated text-ink shadow-sm" : "text-muted")}>
                  {t.name}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-faint">
              {travel === "foot"
                ? "Walking or running: squares only count up to 12 mph, so driving through doesn't."
                : travel === "bike"
                  ? "Squares only count up to 25 mph, so driving through doesn't."
                  : "Any speed counts, driving included."}
            </p>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Label>Modifier cards</Label>
                <p className="mt-1 text-xs text-faint">Now and then a new square deals you a card, like "visit a historical marker". Until you do it, no more squares count for you.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={cards}
                aria-label="Modifier cards"
                onClick={() => setCards(!cards)}
                className={"relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors " + (cards ? "bg-ink" : "bg-line")}
              >
                <span className={"absolute top-1 size-5 rounded-full bg-bg transition-all " + (cards ? "left-6" : "left-1")} />
              </button>
            </div>
            {cards ? (
              deck ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {dealable(deck).map((card) => (
                      <SquareCardArt key={card.id} id={card.id} width={34} />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-faint">
                    {dealable(deck).length} cards can come up here. "Go to" cards only if there's somewhere to go inside {town.name}
                    {SQUARE_CARDS.some((c) => c.cats && !deck[c.id]?.length) ? ` (no ${SQUARE_CARDS.filter((c) => c.cats && !deck[c.id]?.length).map((c) => c.name.toLowerCase()).slice(0, 3).join(", ")}…)` : ""}.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-xs text-faint">Looking for places inside {town.name}…</p>
              )
            ) : null}
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

  async function swap() {
    try {
      await swapCard({ data: { id } });
      await load.current();
      void refreshSquareGames(true);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't swap it.");
    }
  }

  async function pause(on: boolean) {
    try {
      await pauseSquares({ data: { id, on } });
      await load.current();
      // This phone's tracking hears about it now (friends' phones when they next send).
      void refreshSquareGames(true);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't do that.");
    }
  }

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
          <p className="font-serif text-3xl leading-tight">{game.place === "city" ? "City" : game.place === "county" ? "County" : "Park"} complete!</p>
          <p className="text-sm">
            Every square of {game.city}
            {race && ranked[0] ? ` · ${ranked[0].id === state.me ? "you win" : `${ranked[0].name} wins`}` : ""}.
          </p>
        </div>
      ) : null}
      {state.paused && !complete ? (
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
          <Pause className="size-5 shrink-0 text-muted" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            Paused by {nameOf(state.paused.by)} since{" "}
            {new Date(state.paused.since).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}. Tracking won't fill any squares until someone carries on.
          </p>
        </div>
      ) : null}
      <Card>
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-serif text-3xl leading-tight tabular-nums">{view.percent < 10 && view.percent > 0 ? view.percent.toFixed(1) : Math.floor(view.percent)}%</p>
          <span className="text-xs text-faint">
            {game.city}, {game.state} · {TRAVEL_MODES.find((t) => t.id === game.travel)?.name.toLowerCase()} · {race ? "race" : "together"}
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
          {!complete ? (
            <Pill on={!!state.paused} onClick={() => void pause(!state.paused)}>
              <span className="inline-flex items-center gap-1.5">
                {state.paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
                {state.paused ? "Carry on" : "Pause"}
              </span>
            </Pill>
          ) : null}
          {!race ? <span className="text-xs text-faint">{skipsLeft} {skipsLeft === 1 ? "skip" : "skips"} left</span> : null}
        </div>
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
      </Card>
      {game.cards ? <CardsSection board={id} state={state} nameOf={nameOf} onSwap={() => void swap()} onDone={() => void load.current().then(() => refreshSquareGames(true))} /> : null}
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
          Squares fill in when tracking takes you through them{game.travel === "foot" ? " on foot (up to 12 mph)" : game.travel === "bike" ? " by bike (up to 25 mph)" : ""}, from {new Date(game.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} on. Wall in a pocket of up to 4 squares (a big property, say) and it fills in too; circling a bigger area doesn't count.
        </p>
      </Card>
    </>
  );
}

/** Your card (if you're holding one), friends' cards, and the ones you've played. */
function CardsSection({ board, state, nameOf, onSwap, onDone }: { board: string; state: SquaresState; nameOf: (id: string) => string; onSwap: () => void; onDone: () => void }) {
  const mine = state.holding[state.me];
  const card = mine ? cardById(mine.card) : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!card?.wait) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [card?.wait]);
  const friends = Object.entries(state.holding).filter(([pid]) => pid !== state.me);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [at, setAt] = useState<{ lat: number; lon: number } | null>(null);
  const targets = mine?.targets ?? [];

  /** "I'm here": a location read right now, and the card's nearest place has to be within 100 feet. */
  async function imHere() {
    if (!card || !targets.length || checking) return;
    setChecking(true);
    setMsg(null);
    try {
      const { readExactLocation } = await import("@/lib/nearby");
      const fix = await readExactLocation();
      setAt(fix);
      const feetTo = (t: [string, string, number, number]) => Math.hypot((t[2] - fix.lat) * 69, (t[3] - fix.lon) * 69 * Math.cos((fix.lat * Math.PI) / 180)) * 5280;
      const nearest = [...targets].sort((a, b) => feetTo(a) - feetTo(b))[0];
      const feet = feetTo(nearest);
      if (feet > 100) {
        setMsg(`Not quite: ${nearest[1]} is ${feet < 1000 ? `${Math.round(feet)} ft` : `${(feet / 5280).toFixed(1)} mi`} away. Get within 100 ft.${fix.feet > 100 ? " (Your phone's location is fuzzy right now; try again in a moment.)" : ""}`);
        return;
      }
      const res = await playCard({ data: { id: board, place: nearest[0], lat: fix.lat, lon: fix.lon } });
      if (!res.done) {
        setMsg(res.why ?? "That didn't count.");
        return;
      }
      cardFinished(board, card.id, nearest[1]);
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't check where you are.");
    } finally {
      setChecking(false);
    }
  }
  const left = card?.wait && mine ? Math.max(0, Math.ceil((mine.since + card.wait * 60_000 - Date.now()) / 60_000)) : null;
  return (
    <Card>
      <Label>Your card</Label>
      {card && mine ? (
        <div className="mt-3 flex gap-4">
          {targets.length ? (
            <button type="button" onClick={() => void imHere()} aria-label={`${card.name}: I'm here`} className="shrink-0 self-start">
              <SquareCardArt id={card.id} width={112} style={{ transform: "rotate(-4deg)" }} />
            </button>
          ) : (
            <SquareCardArt id={card.id} width={112} style={{ transform: "rotate(-4deg)" }} />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-serif text-xl leading-tight">{card.name}</p>
            <p className="mt-1 text-[15px]">{card.task}</p>
            {targets.length ? <Nearest targets={targets} at={at} /> : null}
            {targets.length ? (
              <button type="button" disabled={checking} onClick={() => void imHere()} className="mt-3 h-10 w-full rounded-lg bg-ink text-sm text-bg disabled:opacity-60">
                {checking ? "Checking where you are…" : "I'm here"}
              </button>
            ) : null}
            {msg ? <p className="mt-2 text-sm text-muted">{msg}</p> : null}
            <p className="mt-2 text-xs text-faint">
              {left != null ? `${left} min to go. ` : ""}No squares count for you until it's done
              {targets.length ? ". Stop at one of these, then tap the card: you need to be within 100 ft (somewhere you've been before counts)." : "; it checks itself off."}
            </p>
            {state.swapsLeft > 0 ? (
              <button type="button" onClick={onSwap} className="mt-3 h-9 rounded-full border border-line px-3 text-xs">
                Can't do it here · swap ({state.swapsLeft} left)
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted">No card. About 1 in {CARD_EVERY} new squares deals one.</p>
      )}
      {friends.length ? (
        <div className="mt-4">
          <p className="text-[11px] tracking-[0.14em] text-faint uppercase">Friends holding</p>
          <ul className="mt-2 grid gap-2">
            {friends.map(([pid, held]) => (
              <li key={pid} className="flex items-center gap-3 text-sm">
                <SquareCardArt id={held.card} width={30} />
                <span className="min-w-0 flex-1">
                  {nameOf(pid)} · {cardById(held.card)?.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.played.length ? (
        <div className="mt-4">
          <p className="text-[11px] tracking-[0.14em] text-faint uppercase">Played ({state.played.length})</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {state.played.slice(0, 24).map((p) => (
              <SquareCardArt key={p.at + p.card} id={p.card} width={30} dim />
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** "You drew a card": shown over the app when tracking deals you one. */
export function DealtCard({ card, onClose, done }: { card: string; onClose: () => void; done?: string }) {
  const info = cardById(card);
  if (!info || typeof document === "undefined") return null;
  // Over everything (the Boards screen included), wherever it's opened from.
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-6" role="dialog" aria-label="You drew a card" onClick={onClose}>
      <div className="flex max-w-xs flex-col items-center text-center" onClick={(event) => event.stopPropagation()}>
        <p className="text-[11px] tracking-[0.18em] text-[#fbf8f0]/80 uppercase">{done ? "City squares · card done" : "City squares · you drew"}</p>
        <SquareCardArt id={card} width={180} className="mt-3 animate-[deal_420ms_ease-out]" style={{ transform: "rotate(-5deg)" }} />
        <p className="mt-5 font-serif text-2xl text-[#fbf8f0]">{info.name}</p>
        <p className="mt-1 text-[15px] text-[#fbf8f0]/90">{done ? `You made it to ${done}.` : info.task}</p>
        {done ? <p className="mt-2 text-xs text-[#fbf8f0]/70">Squares count again.</p> : !info.wild ? <p className="mt-2 text-xs text-[#fbf8f0]/70">No squares count until it's done.</p> : null}
        <button type="button" onClick={onClose} className="mt-5 h-11 rounded-full bg-[#fbf8f0] px-6 text-sm text-[#1c1915]">
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** The card's closest places, from where you are. */
function Nearest({ targets, at }: { targets: [string, string, number, number][]; at: { lat: number; lon: number } | null }) {
  const [read, setRead] = useState<{ lat: number; lon: number } | null>(null);
  // From where you are now (a location read when the card opens), the last tracked point until then.
  useEffect(() => {
    let live = true;
    void import("@/lib/nearby")
      .then((mod) => mod.readDeviceLocation())
      .then((fix) => live && setRead(fix))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const here = at ?? read ?? lastSquaresFix();
  const miles = (lat: number, lon: number) => (here ? Math.hypot((lat - here.lat) * 69, (lon - here.lon) * 69 * Math.cos((here.lat * Math.PI) / 180)) : null);
  const list = [...targets].map((t) => ({ t, d: miles(t[2], t[3]) })).sort((a, b) => (a.d ?? 0) - (b.d ?? 0)).slice(0, 3);
  return (
    <div className="mt-2">
      <p className="text-[11px] tracking-[0.14em] text-faint uppercase">{here ? "Nearest" : `${targets.length} places`}</p>
      <ul className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5 text-sm">
        {list.map(({ t, d }) => (
          <li key={t[0]} className="flex min-w-0 gap-2">
            <span className="min-w-0 flex-1 truncate">{t[1]}</span>
            {d != null ? <span className="shrink-0 text-xs text-muted tabular-nums">{d < 0.02 ? "here" : d < 0.2 ? `${Math.round(d * 5280)} ft` : `${d.toFixed(1)} mi`}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
