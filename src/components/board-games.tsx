/**
 * Travel games on a board, played by everyone it's shared with: license
 * plates, road trip bingo, the alphabet race, cow count, chain spotting, the
 * state line guess, and the scores for name that county and state trivia
 * (those two are asked in Drive mode). Each player's moves are their own
 * rows (by = them), so two phones never undo each other.
 */
import { useMemo, useState } from "react";
import { Check, Minus, Trophy, Undo2 } from "lucide-react";
import { userTag, type BoardItem } from "@/lib/boards";
import { STATE_NAMES } from "@/lib/state-names";
import { KIND_LOOK, Label } from "@/components/board-ui";
import { Card, Pill, type BoardApi } from "@/components/board-kinds";

/** Players on the board, most points first. */
function Leaderboard({ api, rows, unit }: { api: BoardApi; rows: { id: string; score: number; note?: string; win?: boolean }[]; unit: string }) {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  if (!sorted.length) return null;
  return (
    <ul className="mt-3 grid gap-1">
      {sorted.map((row, index) => (
        <li key={row.id} className="flex items-center gap-2 text-sm">
          <span className="w-4 text-xs text-faint tabular-nums">{index + 1}</span>
          <span className={"min-w-0 flex-1 truncate " + (row.id === api.me ? "font-medium" : "")}>{api.name(row.id)}</span>
          {row.win ? <Trophy className="size-4" style={{ color: KIND_LOOK.bingo.tint }} aria-label="Winner" /> : null}
          {row.note ? <span className="text-xs text-faint">{row.note}</span> : null}
          <span className="tabular-nums">
            {row.score.toLocaleString()} <span className="text-xs text-faint">{unit}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------- license plates */

/** A tile map of the states: [abbr, column, row]. */
const TILES: [string, number, number][] = [
  ["AK", 0, 0], ["ME", 10, 0],
  ["VT", 9, 1], ["NH", 10, 1],
  ["WA", 0, 2], ["ID", 1, 2], ["MT", 2, 2], ["ND", 3, 2], ["MN", 4, 2], ["IL", 5, 2], ["WI", 6, 2], ["MI", 7, 2], ["NY", 8, 2], ["RI", 9, 2], ["MA", 10, 2],
  ["OR", 0, 3], ["NV", 1, 3], ["WY", 2, 3], ["SD", 3, 3], ["IA", 4, 3], ["IN", 5, 3], ["OH", 6, 3], ["PA", 7, 3], ["NJ", 8, 3], ["CT", 9, 3],
  ["CA", 0, 4], ["UT", 1, 4], ["CO", 2, 4], ["NE", 3, 4], ["MO", 4, 4], ["KY", 5, 4], ["WV", 6, 4], ["VA", 7, 4], ["MD", 8, 4], ["DE", 9, 4],
  ["AZ", 1, 5], ["NM", 2, 5], ["KS", 3, 5], ["AR", 4, 5], ["TN", 5, 5], ["NC", 6, 5], ["SC", 7, 5], ["DC", 8, 5],
  ["OK", 3, 6], ["LA", 4, 6], ["MS", 5, 6], ["AL", 6, 6], ["GA", 7, 6],
  ["HI", 0, 7], ["TX", 3, 7], ["FL", 8, 7],
];
const PROVINCES: [string, string][] = [
  ["BC", "British Columbia"], ["AB", "Alberta"], ["SK", "Saskatchewan"], ["MB", "Manitoba"], ["ON", "Ontario"], ["QC", "Quebec"],
  ["NB", "New Brunswick"], ["NS", "Nova Scotia"], ["PE", "Prince Edward Island"], ["NL", "Newfoundland and Labrador"], ["YT", "Yukon"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
];
const PLATE_NAMES: Record<string, string> = { ...STATE_NAMES, DC: "Washington, D.C." };

export function PlatesGame({ api }: { api: BoardApi }) {
  const { board } = api;
  const spotted = new Map(board.doc.items.filter((item) => item.meta?.plate).map((item) => [String(item.meta?.plate), item]));
  const states = TILES.filter(([abbr]) => spotted.has(abbr)).length;
  const provinces = PROVINCES.filter(([abbr]) => spotted.has(abbr)).length;
  const [last, setLast] = useState<string | null>(null);
  const tint = KIND_LOOK.plates.tint;

  function toggle(abbr: string, name: string, ca = false) {
    const have = spotted.get(abbr);
    if (have) {
      // Only your own spot can be taken back (unless you can change the board).
      if (have.by !== api.me && !api.canEdit) return;
      api.remove(have.id);
      return;
    }
    api.add(name, { id: `bi-plate${abbr.toLowerCase()}`, done: true, by: api.me, at: Date.now(), meta: { plate: abbr, ...(ca ? { ca: true } : {}) } } as Partial<BoardItem>);
    setLast(abbr);
  }

  const counts = new Map<string, number>();
  for (const item of spotted.values()) if (item.by) counts.set(item.by, (counts.get(item.by) ?? 0) + 1);
  const lastItem = last ? spotted.get(last) : null;

  return (
    <>
      <Card>
        <div className="flex items-baseline justify-between">
          <p className="font-serif text-3xl leading-tight tabular-nums">
            {states}
            <span className="text-lg text-muted"> / 51</span>
          </p>
          {provinces ? <span className="text-sm text-muted">+{provinces} Canadian</span> : null}
        </div>
        <p className="text-xs text-faint">{lastItem ? `${lastItem.text}, spotted by ${api.name(lastItem.by)}` : "Tap a state when someone spots its plate."}</p>
        {/* The map. */}
        <div className="mt-3 grid gap-[3px]" style={{ gridTemplateColumns: "repeat(11, minmax(0, 1fr))" }}>
          {Array.from({ length: 8 * 11 }, (_, cell) => {
            const col = cell % 11;
            const row = Math.floor(cell / 11);
            const tile = TILES.find(([, c, r]) => c === col && r === row);
            if (!tile) return <span key={cell} />;
            const [abbr] = tile;
            const item = spotted.get(abbr);
            return (
              <button
                key={abbr}
                type="button"
                aria-pressed={!!item}
                aria-label={`${PLATE_NAMES[abbr]}${item ? `, spotted by ${api.name(item.by)}` : ""}`}
                onClick={() => toggle(abbr, PLATE_NAMES[abbr] ?? abbr)}
                className={"grid aspect-square place-items-center rounded-[5px] text-[10px] font-medium tracking-tight transition-colors " + (item ? "text-bg" : "bg-bg/70 text-faint active:bg-elevated")}
                style={item ? { background: tint } : undefined}
              >
                {abbr}
              </button>
            );
          })}
        </div>
        <Leaderboard api={api} rows={[...counts].map(([id, score]) => ({ id, score }))} unit="spotted" />
      </Card>
      <section className="mx-4 mt-4">
        <Label>Canada (bonus)</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PROVINCES.map(([abbr, name]) => (
            <Pill key={abbr} on={spotted.has(abbr)} onClick={() => toggle(abbr, name, true)}>
              {name}
            </Pill>
          ))}
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ bingo */

const BINGO_POOL = [
  "Cows", "Horses", "Water tower", "RV", "Motorcycle", "Tractor", "Train", "Bridge", "Billboard for a lawyer", "Church steeple",
  "Barn", "Windmill", "Silo", "Dog in a car", "Cop with someone pulled over", "Rest area", "Gas under $3", "Flag", "Construction zone", "Deer",
  "Hawk on a pole", "Truck with a boat", "Convertible", "Out-of-state plate", "Car with bikes", "Cemetery", "Lake or pond", "Historical marker", "Welcome sign", "Hitchhiker",
  "Fireworks stand", "Waffle House", "Jesus billboard", "Antique shop", "Mile marker 100", "Speed trap", "Yellow car", "Limo", "Tunnel", "Roadkill",
];

function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A player's card: 24 squares from the pool, shuffled by board and player, with a free middle. */
export function bingoCard(boardId: string, userId: string) {
  const rand = seeded(`${boardId}:${userId}`);
  const pool = BINGO_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const cells = pool.slice(0, 24);
  cells.splice(12, 0, "Free");
  return cells;
}

const LINES = [
  ...[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)),
  ...[0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

function bingoState(marked: Set<number>) {
  const has = (cell: number) => cell === 12 || marked.has(cell);
  const lines = LINES.filter((line) => line.every(has));
  const best = Math.max(...LINES.map((line) => line.filter(has).length));
  return { lines, best };
}

export function BingoGame({ api }: { api: BoardApi }) {
  const { board } = api;
  const tag = userTag(api.me);
  const card = useMemo(() => bingoCard(board.id, api.me), [board.id, api.me]);
  const marksOf = (id: string) => new Set(board.doc.items.filter((item) => item.by === id && item.meta?.bingoCell != null).map((item) => Number(item.meta?.bingoCell)));
  const mine = marksOf(api.me);
  const me = bingoState(mine);
  const tint = KIND_LOOK.bingo.tint;
  const players = [...new Set([api.me, ...board.doc.items.map((item) => item.by).filter((id): id is string => !!id)])];
  const winners = board.doc.items.filter((item) => item.meta?.bingo).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const first = winners[0];

  function toggle(cell: number) {
    if (cell === 12) return;
    const id = `bi-bg${tag}${String(cell).padStart(2, "0")}`;
    const have = board.doc.items.find((item) => item.id === id);
    if (have) {
      api.remove(id);
      return;
    }
    const next = new Set(mine).add(cell);
    const bingo = bingoState(next).lines.length > me.lines.length && !me.lines.length;
    api.add(card[cell], { id, done: true, by: api.me, at: Date.now(), meta: { bingoCell: cell, ...(bingo ? { bingo: true } : {}) } } as Partial<BoardItem>);
  }

  return (
    <>
      {first ? (
        <div className="mx-4 mt-4 rounded-2xl p-4 text-center text-bg" style={{ background: tint }}>
          <p className="font-serif text-3xl leading-tight">Bingo!</p>
          <p className="text-sm">{first.by === api.me ? "You got it first." : `${api.name(first.by)} got it first.`}</p>
        </div>
      ) : null}
      <Card>
        <div className="flex items-baseline justify-between">
          <Label>Your card</Label>
          <span className="text-xs text-faint">{me.lines.length ? `${me.lines.length} ${me.lines.length === 1 ? "line" : "lines"}` : `${me.best} of 5 in a line`}</span>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1">
          {card.map((label, cell) => {
            const on = cell === 12 || mine.has(cell);
            const inLine = me.lines.some((line) => line.includes(cell));
            return (
              <button
                key={cell}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(cell)}
                className={"grid aspect-square place-items-center rounded-lg p-0.5 text-center text-[10px] leading-tight transition-colors " + (on ? "text-bg" : "bg-bg/70 text-ink active:bg-elevated")}
                style={on ? { background: inLine ? tint : `${tint}aa` } : undefined}
              >
                {cell === 12 ? <span className="font-serif text-sm">Free</span> : label}
              </button>
            );
          })}
        </div>
        <Leaderboard
          api={api}
          unit="in a line"
          rows={players.map((id) => {
            const s = bingoState(marksOf(id));
            return { id, score: s.lines.length ? 5 : s.best, win: !!s.lines.length, note: `${marksOf(id).size} marked` };
          })}
        />
        <p className="mt-2 text-xs text-faint">Everyone has a different card. Five in a row, across, down or corner to corner.</p>
      </Card>
    </>
  );
}

/* ---------------------------------------------------------- alphabet race */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function AlphaGame({ api }: { api: BoardApi }) {
  const { board } = api;
  const id = `bi-al${userTag(api.me)}`;
  const mine = board.doc.items.find((item) => item.id === id);
  const n = Number(mine?.meta?.n) || 0;
  const rows = board.doc.items.filter((item) => item.id.startsWith("bi-al") && item.by);
  const done = rows.filter((item) => Number(item.meta?.n) >= 26).sort((a, b) => Number(a.meta?.doneAt ?? 0) - Number(b.meta?.doneAt ?? 0));
  const tint = KIND_LOOK.alpha.tint;
  const set = (next: number) => {
    const meta = { n: next, ...(next >= 26 ? { doneAt: Date.now() } : {}) };
    if (mine) api.update(id, { meta, at: Date.now() });
    else api.add("alphabet", { id, by: api.me, at: Date.now(), meta } as Partial<BoardItem>);
  };
  return (
    <Card>
      {n < 26 ? (
        <div className="text-center">
          <Label>Look for a word starting with</Label>
          <p className="font-serif text-7xl leading-none" style={{ color: tint }}>
            {LETTERS[n]}
          </p>
          <p className="mt-1 text-xs text-faint">On signs, plates, trucks. Q and Z are the hard ones.</p>
        </div>
      ) : (
        <div className="text-center">
          <p className="font-serif text-3xl">A to Z!</p>
          <p className="text-sm text-muted">{done[0]?.by === api.me ? "You finished first." : `${api.name(done[0]?.by)} finished first.`}</p>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={n === 0} onClick={() => set(n - 1)} aria-label="Undo" className="grid size-12 shrink-0 place-items-center rounded-lg border border-line text-muted disabled:text-line">
          <Undo2 className="size-5" />
        </button>
        <button type="button" disabled={n >= 26} onClick={() => set(n + 1)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-ink text-[15px] text-bg disabled:bg-elevated disabled:text-faint">
          <Check className="size-5" />
          {n < 26 ? `Found ${LETTERS[n]}` : "Done"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {LETTERS.map((letter, i) => (
          <span key={letter} className={"grid size-6 place-items-center rounded text-[11px] " + (i < n ? "text-bg" : "bg-bg/70 text-faint")} style={i < n ? { background: tint } : undefined}>
            {letter}
          </span>
        ))}
      </div>
      <Leaderboard api={api} unit="letters" rows={rows.map((item) => ({ id: item.by as string, score: Math.min(26, Number(item.meta?.n) || 0), win: done[0]?.id === item.id }))} />
    </Card>
  );
}

/* ---------------------------------------------------------------- cow count */

export function CowsGame({ api }: { api: BoardApi }) {
  const { board } = api;
  const id = `bi-cw${userTag(api.me)}`;
  const mine = board.doc.items.find((item) => item.id === id);
  const cows = Number(mine?.meta?.cows) || 0;
  const bugs = Number(mine?.meta?.bugs) || 0;
  const lost = Number(mine?.meta?.lost) || 0;
  const [flash, setFlash] = useState<string | null>(null);
  const rows = board.doc.items.filter((item) => item.id.startsWith("bi-cw") && item.by);
  const set = (meta: Record<string, number>) => {
    const next = { cows, bugs, lost, ...meta };
    if (mine) api.update(id, { meta: next, at: Date.now() });
    else api.add("cows", { id, by: api.me, at: Date.now(), meta: next } as Partial<BoardItem>);
  };
  return (
    <>
      <Card>
        <div className="text-center">
          <Label>Your cows</Label>
          <p className="font-serif text-6xl leading-none tabular-nums">{cows}</p>
          {flash ? <p className="mt-1 text-sm text-muted">{flash}</p> : <p className="mt-1 text-xs text-faint">Only the ones on your side of the car.</p>}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <button type="button" onClick={() => set({ cows: Math.max(0, cows - 1) })} aria-label="One less" className="grid h-12 place-items-center rounded-lg border border-line text-muted">
            <Minus className="size-5" />
          </button>
          <button type="button" onClick={() => set({ cows: cows + 1 })} className="h-12 rounded-lg bg-ink text-bg">
            +1
          </button>
          <button type="button" onClick={() => set({ cows: cows + 5 })} className="h-12 rounded-lg bg-ink text-bg">
            +5
          </button>
          <button type="button" onClick={() => set({ cows: cows + 20 })} className="h-12 rounded-lg bg-ink text-bg">
            Herd
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setFlash(cows ? `A cemetery! ${cows} cows gone.` : "A cemetery, but you had no cows to lose.");
              set({ cows: 0, lost: lost + cows });
            }}
            className="h-11 rounded-lg border border-line text-sm"
          >
            Cemetery on my side
          </button>
          <button
            type="button"
            onClick={() => {
              setFlash("Slug bug!");
              set({ bugs: bugs + 1 });
            }}
            className="h-11 rounded-lg border border-line text-sm"
          >
            Slug bug · {bugs}
          </button>
        </div>
        <Leaderboard
          api={api}
          unit="cows"
          rows={rows.map((item) => ({ id: item.by as string, score: Number(item.meta?.cows) || 0, note: Number(item.meta?.bugs) ? `${item.meta?.bugs} bugs` : undefined }))}
        />
      </Card>
    </>
  );
}

/* ----------------------------------------------------------- chain spotting */

/** Regional chains, by where you'd find them. `match`: how the name starts in the atlas. */
export const CHAIN_REGIONS: { id: string; name: string; chains: string[] }[] = [
  { id: "texas", name: "Texas", chains: ["Whataburger", "Buc-ee's", "Shipley Do-Nuts", "Bill Miller Bar-B-Q", "Torchy's Tacos", "H-E-B", "Raising Cane's", "Church's"] },
  { id: "south", name: "The South", chains: ["Waffle House", "Cook Out", "Bojangles", "Zaxby's", "Krystal", "Publix", "Cracker Barrel", "Huddle House", "Chick-fil-A"] },
  { id: "midwest", name: "The Midwest", chains: ["Culver's", "Casey's", "Kwik Trip", "Portillo's", "Steak 'n Shake", "Hy-Vee", "Skyline Chili", "White Castle", "Menards"] },
  { id: "northeast", name: "The Northeast", chains: ["Wawa", "Sheetz", "Dunkin'", "Friendly's", "Stewart's Shops", "Wegmans", "Tim Hortons", "Royal Farms"] },
  { id: "plains", name: "Plains & Rockies", chains: ["Runza", "Braum's", "Village Inn", "Maverik", "Taco John's", "Love's", "Sonic"] },
  { id: "west", name: "The West", chains: ["In-N-Out Burger", "Dutch Bros", "Del Taco", "Carl's Jr.", "Jack in the Box", "WinCo Foods", "Black Bear Diner"] },
];

export function ChainsGame({ api }: { api: BoardApi }) {
  const { board, canEdit } = api;
  const have = new Set(board.doc.items.map((item) => item.text.toLowerCase()));
  const chosen = new Set(String(board.doc.extra?.regions ?? "").split(",").filter(Boolean));
  const spotted = board.doc.items.filter((item) => item.done);
  const counts = new Map<string, number>();
  for (const item of spotted) if (item.by) counts.set(item.by, (counts.get(item.by) ?? 0) + 1);
  function addRegion(id: string) {
    const region = CHAIN_REGIONS.find((r) => r.id === id);
    if (!region) return;
    const fresh = region.chains.filter((name) => !have.has(name.toLowerCase()));
    api.setExtra({ regions: [...chosen, id].join(",") });
    api.setItems([...api.items(), ...fresh.map((name, i) => ({ id: `bi-ch${Date.now().toString(36)}${i}`, text: name, note: "", done: false, meta: { region: id } }))]);
  }
  const tint = KIND_LOOK.chains.tint;
  return (
    <>
      {canEdit ? (
        <section className="mx-4 mt-4">
          <Label>Where are you driving?</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CHAIN_REGIONS.map((region) => (
              <Pill key={region.id} on={chosen.has(region.id)} disabled={chosen.has(region.id)} onClick={() => addRegion(region.id)}>
                {region.name}
              </Pill>
            ))}
          </div>
        </section>
      ) : null}
      {board.doc.items.length ? (
        <Card>
          <p className="text-sm">
            {spotted.length} of {board.doc.items.length} spotted
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {board.doc.items.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.done}
                onClick={() => api.update(item.id, item.done ? { done: false, by: null, at: null } : { done: true, by: api.me, at: Date.now() })}
                className={"min-h-12 rounded-xl px-3 py-2 text-left text-sm " + (item.done ? "text-bg" : "bg-bg/70 active:bg-elevated")}
                style={item.done ? { background: tint } : undefined}
              >
                <span className="block leading-tight">{item.text}</span>
                {item.done ? <span className="block text-[11px] opacity-80">{api.name(item.by)}</span> : null}
              </button>
            ))}
          </div>
          <Leaderboard api={api} unit="spotted" rows={[...counts].map(([id, score]) => ({ id, score }))} />
          <p className="mt-2 text-xs text-faint">Ticks itself off when tracking adds one to anyone's map. Tap one you saw from the road.</p>
        </Card>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------- state line guess */

export function GuessGame({ api, here }: { api: BoardApi; here: () => Promise<string | null> }) {
  const { board } = api;
  const roundAt = Number(board.doc.extra?.roundAt) || 0;
  const from = String(board.doc.extra?.from ?? "");
  const result = board.doc.extra?.result == null ? null : Number(board.doc.extra.result);
  const to = String(board.doc.extra?.to ?? "");
  const guesses = board.doc.items.filter((item) => item.meta?.round === roundAt && item.by);
  const mine = guesses.find((item) => item.by === api.me);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const elapsed = roundAt ? Math.round((Date.now() - roundAt) / 60000) : 0;
  const ranked = result == null ? guesses : [...guesses].sort((a, b) => Math.abs(Number(a.meta?.min) - result) - Math.abs(Number(b.meta?.min) - result));
  const wins = board.doc.items.filter((item) => item.meta?.won);
  const winCounts = new Map<string, number>();
  for (const item of wins) if (item.by) winCounts.set(item.by, (winCounts.get(item.by) ?? 0) + 1);

  async function start() {
    setStarting(true);
    setNote(null);
    const state = await here().catch(() => null);
    setStarting(false);
    if (!state) {
      setNote("Turn on location so the game knows which state you're in.");
      return;
    }
    api.setExtra({ roundAt: Date.now(), from: state, result: null, to: null });
  }

  return (
    <Card>
      {!roundAt || result != null ? (
        <>
          {result != null ? (
            <div className="text-center">
              <Label>Crossed into {STATE_NAMES[to] ?? to}</Label>
              <p className="font-serif text-4xl leading-tight tabular-nums">{result} min</p>
              {ranked[0] ? <p className="text-sm">{ranked[0].by === api.me ? "You" : api.name(ranked[0].by)} guessed closest ({ranked[0].meta?.min} min).</p> : <p className="text-sm text-muted">Nobody guessed.</p>}
            </div>
          ) : (
            <p className="text-sm text-muted">Start a round, then everyone guesses how many minutes until you cross into the next state. The app calls it when you do.</p>
          )}
          <button type="button" disabled={starting} onClick={() => void start()} className="mt-3 h-12 w-full rounded-lg bg-ink text-[15px] text-bg disabled:opacity-60">
            {starting ? "Finding where you are…" : result != null ? "Next round" : "Start a round"}
          </button>
          {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
        </>
      ) : (
        <>
          <div className="text-center">
            <Label>Leaving {STATE_NAMES[from] ?? from}</Label>
            <p className="font-serif text-4xl leading-tight tabular-nums">{elapsed} min</p>
            <p className="text-xs text-faint">so far</p>
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const n = Math.round(Number(minutes));
              if (!Number.isFinite(n) || n < 0 || n > 2000) return;
              const id = `bi-gs${userTag(api.me)}${(roundAt % 1679616).toString(36).padStart(4, "0")}`;
              if (mine) api.update(mine.id, { meta: { round: roundAt, min: n }, at: Date.now() });
              else api.add(`${n}`, { id, by: api.me, at: Date.now(), meta: { round: roundAt, min: n } } as Partial<BoardItem>);
              setMinutes("");
            }}
          >
            <input inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder={mine ? `Your guess: ${mine.meta?.min} min` : "Minutes until the line?"} className="h-12 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-base outline-none placeholder:text-faint" />
            <button type="submit" disabled={!minutes.trim()} className="h-12 shrink-0 rounded-lg bg-ink px-4 text-sm text-bg disabled:bg-elevated disabled:text-faint">
              {mine ? "Change" : "Guess"}
            </button>
          </form>
        </>
      )}
      {guesses.length ? (
        <ul className="mt-3 grid gap-1">
          {ranked.map((item, i) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              {result != null && i === 0 ? <Trophy className="size-4" style={{ color: KIND_LOOK.guess.tint }} aria-label="Closest" /> : <span className="w-4" />}
              <span className="min-w-0 flex-1 truncate">{api.name(item.by)}</span>
              <span className="tabular-nums">{item.meta?.min} min</span>
            </li>
          ))}
        </ul>
      ) : null}
      {winCounts.size ? (
        <>
          <p className="mt-4 text-[11px] tracking-[0.14em] text-faint uppercase">Rounds won</p>
          <Leaderboard api={api} unit="won" rows={[...winCounts].map(([id, score]) => ({ id, score }))} />
        </>
      ) : null}
    </Card>
  );
}

/* --------------------------------------------- name that county / state trivia */

export function QuizBoard({ api }: { api: BoardApi }) {
  const { board } = api;
  const county = board.kind === "county";
  const rows = board.doc.items.filter((item) => item.id.startsWith("bi-sc") && item.by);
  const mine = rows.find((item) => item.by === api.me);
  return (
    <Card>
      <p className="text-sm text-muted">
        {county
          ? "In Drive mode, just before a county line, the app asks which county you're about to enter. Tap the answer (or have a passenger tap it)."
          : "In Drive mode, each time you cross into a state the app asks a question about it: its capital or its nickname."}
      </p>
      {mine ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {(
            [
              [`${mine.meta?.right ?? 0}/${mine.meta?.asked ?? 0}`, "right"],
              [String(mine.meta?.streak ?? 0), "streak"],
              [String(mine.meta?.best ?? 0), "best streak"],
            ] as const
          ).map(([value, label]) => (
            <div key={label}>
              <p className="font-serif text-2xl leading-tight tabular-nums">{value}</p>
              <p className="text-[11px] tracking-[0.14em] text-faint uppercase">{label}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm">No questions yet. Turn on Drive mode and go.</p>
      )}
      {mine?.meta?.last ? (
        <p className="mt-3 text-xs text-faint">
          Last: {String(mine.meta.last)} {mine.meta.lastRight ? "· right" : "· missed"}
        </p>
      ) : null}
      <Leaderboard api={api} unit="right" rows={rows.map((item) => ({ id: item.by as string, score: Number(item.meta?.right) || 0, note: `of ${item.meta?.asked ?? 0}` }))} />
    </Card>
  );
}

