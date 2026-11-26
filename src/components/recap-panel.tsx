import { useEffect, useState } from "react";
import { STATE_NAMES } from "@/lib/state-names";
import { Send, Share2 } from "lucide-react";
import { SendImageSheet } from "@/components/chat-send";
import { flushDriveLog } from "@/lib/drive-log";
import { formatMiles } from "@/lib/ghost-trail";
import { nativeApp } from "@/lib/native";
import { getRecap, periodRange, type Recap, type RecapPeriod } from "@/lib/recap";
import { onThisDay, streaks, yearsAgo } from "@/lib/memories";
import type { Mark } from "@/lib/marks";

const PERIODS: [RecapPeriod, string][] = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["last-month", "Last month"],
  ["year", "This year"],
];


const n = (value: number) => value.toLocaleString();
const plural = (count: number, one: string, many: string) =>
  `${n(count)} ${count === 1 ? one : many}`;

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-3">
      <div className="font-serif text-3xl leading-none">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

/** Streaks and "on this day", above the period recap. */
function LookBack({ marks, onOpenPlace }: { marks: Mark[]; onOpenPlace: (mark: Mark) => void }) {
  const [all, setAll] = useState(false);
  const memories = onThisDay(marks);
  const run = streaks(marks);
  if (!marks.length) return null;
  const shown = all ? memories : memories.slice(0, 3);
  return (
    <div className="mb-5">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line px-3 py-2">
          <p className="font-serif text-2xl leading-tight">{run.days ? `${run.days} ${run.days === 1 ? "day" : "days"}` : "—"}</p>
          <p className="text-xs text-muted">
            {run.days ? (run.dayDone ? "in a row with a visit" : "in a row. Visit somewhere today to keep it") : "Visit somewhere today to start a streak"}
          </p>
        </div>
        <div className="rounded-lg border border-line px-3 py-2">
          <p className="font-serif text-2xl leading-tight">{run.weeks ? `${run.weeks} ${run.weeks === 1 ? "week" : "weeks"}` : "—"}</p>
          <p className="text-xs text-muted">
            {run.weeks
              ? run.weekDone
                ? "in a row with a new place"
                : "in a row. A new place this week keeps it"
              : "A new place this week starts a streak"}
            {run.bestWeeks > run.weeks ? ` · best ${run.bestWeeks}` : ""}
          </p>
        </div>
      </div>
      {memories.length ? (
        <div className="mt-4">
          <p className="text-xs tracking-widest text-faint uppercase">On this day</p>
          <ul className="mt-1 grid gap-2">
            {shown.map((memory) => (
              <li key={memory.mark.id}>
                <button
                  type="button"
                  onClick={() => onOpenPlace(memory.mark)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-left"
                >
                  <span className="block text-xs text-accent">{yearsAgo(memory.years)}</span>
                  <span className="block font-serif text-lg leading-tight">{memory.mark.name}</span>
                  <span className="block text-xs text-faint">
                    {STATE_NAMES[memory.mark.state] ?? memory.mark.state} · {new Date(`${memory.day}T12:00:00`).getFullYear()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {memories.length > 3 ? (
            <button type="button" onClick={() => setAll(!all)} className="mt-1 h-10 text-sm text-muted">
              {all ? "Fewer" : `All ${memories.length} from this day`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RecapPanel({ name, marks = [], onOpenPlace }: { name: string; marks?: Mark[]; onOpenPlace?: (mark: Mark) => void }) {
  const [period, setPeriod] = useState<RecapPeriod>("month");
  const [recap, setRecap] = useState<Recap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const range = periodRange(period);

  useEffect(() => {
    let live = true;
    setRecap(null);
    setError(null);
    const { from, to, tz } = periodRange(period);
    // Send today's miles first so the recap includes them.
    void flushDriveLog()
      .catch(() => undefined)
      .then(() => getRecap({ data: { from, to, tz } }))
      .then((row) => {
        if (live) setRecap(row);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Couldn't load the recap.");
      });
    return () => {
      live = false;
    };
  }, [period]);

  const [sending, setSending] = useState(false);

  async function share() {
    if (!recap) return;
    setBusy(true);
    setNote(null);
    try {
      const blob = await drawCard(recap, range.label, name);
      const result = await shareImage(
        blob,
        `atlas-recap-${recap.from}.png`,
        `My ${range.title} on The American Atlas`,
      );
      if (result === "saved") setNote("Saved the card as an image.");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setNote(err instanceof Error ? err.message : "Couldn't share the card.");
      }
    } finally {
      setBusy(false);
    }
  }

  const empty = recap && !recap.places && !recap.miles && !recap.points && !recap.longestTrail;

  return (
    <div className="px-4 pb-4">
      <h2 className="font-serif text-2xl">Recap</h2>
      <div className="mt-3">
        <LookBack marks={marks} onOpenPlace={(mark) => onOpenPlace?.(mark)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {PERIODS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={period === id}
            onClick={() => setPeriod(id)}
            className={
              "h-11 grow basis-[30%] rounded-lg border px-2 text-sm " +
              (period === id ? "border-ink bg-elevated" : "border-line text-muted")
            }
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-3 font-serif text-xl">{range.label}</p>

      {error ? <p className="mt-2 text-sm text-accent">{error}</p> : null}
      {!recap && !error ? <p className="mt-2 text-sm text-muted">Adding it up…</p> : null}
      {recap ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat
              value={formatMiles(recap.miles).replace(/ mi$/, "")}
              label={recap.miles === 1 ? "mile driven" : "miles driven"}
            />
            <Stat value={n(recap.points)} label="points" />
            <Stat
              value={n(recap.newStates.length)}
              label={recap.newStates.length === 1 ? "new state" : "new states"}
            />
            <Stat
              value={n(recap.counties)}
              label={recap.counties === 1 ? "new county" : "new counties"}
            />
            <Stat
              value={n(recap.towns)}
              label={recap.towns === 1 ? "new town or city" : "new towns and cities"}
            />
            <Stat
              value={n(recap.places)}
              label={recap.places === 1 ? "new place in all" : "new places in all"}
            />
          </div>
          {recap.newStates.length ? (
            <p className="mt-3 text-sm">
              <span className="text-muted">New states: </span>
              {recap.newStates.map((s) => STATE_NAMES[s] ?? s).join(", ")}
            </p>
          ) : null}
          <p className="mt-2 text-sm">
            <span className="text-muted">Longest trail: </span>
            {recap.longestTrail
              ? `${recap.longestTrail.name}, ${formatMiles(recap.longestTrail.miles)}`
              : "none saved"}
          </p>
          <p className="mt-2 text-xs text-faint">
            Miles count while tracking is on
            {recap.driveDays ? `, over ${plural(recap.driveDays, "day", "days")}` : ""}.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || !!empty}
              onClick={() => setSending(true)}
              className="flex h-11 items-center justify-center gap-2 rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint"
            >
              <Send className="size-4" aria-hidden />
              Send to a friend
            </button>
            <button
              type="button"
              disabled={busy || !!empty}
              onClick={() => void share()}
              className="flex h-11 items-center justify-center gap-2 rounded-lg border border-line text-sm disabled:text-faint"
            >
              <Share2 className="size-4" aria-hidden />
              {busy ? "Making it…" : "Share card"}
            </button>
          </div>
          {sending ? (
            <SendImageSheet
              label={`Send your ${range.title}`}
              makeImage={() => drawCard(recap, range.label, name)}
              onClose={() => setSending(false)}
            />
          ) : null}
          {empty ? (
            <p className="mt-2 text-sm text-muted">
              Nothing here yet. Add a place or drive with tracking on.
            </p>
          ) : null}
          {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- card

const CARD = { w: 1080, h: 1350 };
const INK = "#f3f0e6";
const MUTED = "#a39e90";
const LINE = "#34382f";
const GOLD = "#e2b15a";

async function drawCard(recap: Recap, label: string, name: string): Promise<Blob> {
  if (typeof document !== "undefined" && document.fonts?.ready)
    await document.fonts.ready.catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = CARD.w;
  canvas.height = CARD.h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Couldn't draw the card.");
  const serif = '"Newsreader", Georgia, serif';
  const sans = '"Outfit", system-ui, sans-serif';

  const bg = g.createLinearGradient(0, 0, 0, CARD.h);
  bg.addColorStop(0, "#1c1f18");
  bg.addColorStop(1, "#121410");
  g.fillStyle = bg;
  g.fillRect(0, 0, CARD.w, CARD.h);

  // A faint contour, like an old survey map.
  g.strokeStyle = "rgba(226,177,90,0.10)";
  g.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    for (let x = 0; x <= CARD.w; x += 20) {
      const y = 1010 + i * 40 + Math.sin(x / 140 + i * 0.7) * 26 + Math.sin(x / 61 + i) * 8;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  const pad = 84;
  g.fillStyle = GOLD;
  g.font = `500 34px ${sans}`;
  g.fillText("THE AMERICAN ATLAS", pad, 130);
  g.fillStyle = INK;
  g.font = `400 96px ${serif}`;
  g.fillText(fit(g, label, CARD.w - pad * 2), pad, 245);
  g.fillStyle = MUTED;
  g.font = `400 38px ${sans}`;
  g.fillText(fit(g, name ? `${name}'s recap` : "Recap", CARD.w - pad * 2), pad, 305);

  const stats: [string, string][] = [
    [
      formatMiles(recap.miles).replace(/ mi$/, ""),
      recap.miles === 1 ? "mile driven" : "miles driven",
    ],
    [n(recap.newStates.length), recap.newStates.length === 1 ? "new state" : "new states"],
    [n(recap.counties), recap.counties === 1 ? "new county" : "new counties"],
    [n(recap.towns), recap.towns === 1 ? "new town" : "new towns"],
  ];
  const colW = (CARD.w - pad * 2 - 40) / 2;
  stats.forEach(([value, what], i) => {
    const x = pad + (i % 2) * (colW + 40);
    const y = 380 + Math.floor(i / 2) * 250;
    g.strokeStyle = LINE;
    g.lineWidth = 3;
    roundRect(g, x, y, colW, 210, 22);
    g.stroke();
    g.fillStyle = INK;
    g.font = `400 112px ${serif}`;
    g.fillText(fit(g, value, colW - 60), x + 32, y + 128);
    g.fillStyle = MUTED;
    g.font = `400 36px ${sans}`;
    g.fillText(what, x + 32, y + 180);
  });

  let y = 930;
  g.font = `400 38px ${sans}`;
  if (recap.longestTrail) {
    g.fillStyle = MUTED;
    g.fillText("Longest trail", pad, y);
    g.fillStyle = INK;
    g.font = `400 52px ${serif}`;
    g.fillText(
      fit(
        g,
        `${recap.longestTrail.name} · ${formatMiles(recap.longestTrail.miles)}`,
        CARD.w - pad * 2,
      ),
      pad,
      y + 64,
    );
    y += 150;
  }
  if (recap.newStates.length) {
    g.fillStyle = MUTED;
    g.font = `400 38px ${sans}`;
    g.fillText(recap.newStates.length === 1 ? "New state" : "New states", pad, y);
    g.fillStyle = INK;
    g.font = `400 44px ${serif}`;
    g.fillText(
      fit(g, recap.newStates.map((s) => STATE_NAMES[s] ?? s).join(", "), CARD.w - pad * 2),
      pad,
      y + 60,
    );
  }

  g.fillStyle = GOLD;
  g.font = `500 40px ${sans}`;
  g.fillText(`${n(recap.points)} points`, pad, CARD.h - 90);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't draw the card."))),
      "image/png",
    ),
  );
}

/** Shorten text with an ellipsis until it fits. */
function fit(g: CanvasRenderingContext2D, text: string, width: number) {
  if (g.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && g.measureText(cut + "…").width > width) cut = cut.slice(0, -1);
  return cut.trimEnd() + "…";
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Share sheet on the phone app and supporting browsers; otherwise download the image. */
async function shareImage(
  blob: Blob,
  filename: string,
  title: string,
): Promise<"shared" | "saved"> {
  if (nativeApp) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const file = await Filesystem.writeFile({
      path: filename,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });
    await Share.share({ title, files: [file.uri], dialogTitle: "Share your recap" });
    return "shared";
  }
  const file = new File([blob], filename, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    await navigator.share({ title, files: [file] });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}
