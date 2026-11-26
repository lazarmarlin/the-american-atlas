import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Send, Share2, X } from "lucide-react";
import { SendImageSheet } from "@/components/chat-send";
import { formatMiles } from "@/lib/ghost-trail";
import type { Mark } from "@/lib/marks";
import { getRecap, type Recap } from "@/lib/recap";
import { useBackClose } from "@/lib/sheet-back";
import { STATE_NAMES } from "@/lib/state-names";

/**
 * Your year, one screen at a time: tap to go on (or wait), hold to pause.
 * Miles, places, states, counties, your top state, most-visited place and
 * busiest day, then a card to share or send to a friend.
 */

const SLIDE_MS = 5200;

type Slide = { key: string; eyebrow: string; big: string; count?: number; line: string; tone: string };

/** Counts up to the number when the slide opens. */
function CountUp({ to, format }: { to: number; format: (n: number) => string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1100);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return <>{format(n)}</>;
}

function yearStats(marks: Mark[], year: number) {
  const prefix = `${year}-`;
  const byState = new Map<string, number>();
  const byPlace = new Map<string, { mark: Mark; n: number }>();
  const byDay = new Map<string, number>();
  for (const mark of marks) {
    for (const visit of mark.visits) {
      if (!visit.visitedOn?.startsWith(prefix)) continue;
      byState.set(mark.state, (byState.get(mark.state) ?? 0) + 1);
      const cur = byPlace.get(mark.id);
      byPlace.set(mark.id, { mark, n: (cur?.n ?? 0) + 1 });
      byDay.set(visit.visitedOn, (byDay.get(visit.visitedOn) ?? 0) + 1);
    }
  }
  const top = <K,>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const topPlace = [...byPlace.values()].filter((p) => p.mark.category !== "county" && p.mark.category !== "route").sort((a, b) => b.n - a.n)[0] ?? null;
  return { topState: top(byState), topPlace, busiest: top(byDay), visits: [...byDay.values()].reduce((a, b) => a + b, 0) };
}

export function YearReview({
  year,
  name,
  marks,
  makeCard,
  onShare,
  onClose,
}: {
  year: number;
  name: string;
  marks: Mark[];
  /** The year's recap as a picture (for Share / Send). */
  makeCard: (recap: Recap) => Promise<Blob>;
  onShare: (recap: Recap) => Promise<void>;
  onClose: () => void;
}) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sending, setSending] = useState(false);
  const holdTimer = useRef(0);
  useBackClose(onClose);

  useEffect(() => {
    let live = true;
    getRecap({ data: { from: `${year}-01-01`, to: `${year}-12-31`, tz: new Date().getTimezoneOffset() } })
      .then((row) => live && setRecap(row))
      .catch((err) => live && setError(err instanceof Error ? err.message : "Couldn't load your year."));
    return () => {
      live = false;
    };
  }, [year]);

  const stats = useMemo(() => yearStats(marks, year), [marks, year]);
  const slides = useMemo<Slide[]>(() => {
    if (!recap) return [];
    const out: Slide[] = [{ key: "hi", eyebrow: name ? `${name.split(" ")[0]}'s` : "Your", big: String(year), line: "on The American Atlas", tone: "#e2b15a" }];
    if (recap.miles >= 1) out.push({ key: "miles", eyebrow: "You drove", big: "", count: Math.round(recap.miles), line: "miles with tracking on", tone: "#9aa7ff" });
    out.push({ key: "places", eyebrow: "You added", big: "", count: recap.places, line: recap.places === 1 ? "new place" : "new places", tone: "#7dcea0" });
    if (recap.newStates.length)
      out.push({
        key: "states",
        eyebrow: recap.newStates.length === 1 ? "A new state" : `${recap.newStates.length} new states`,
        big: recap.newStates.length <= 3 ? recap.newStates.map((s) => STATE_NAMES[s] ?? s).join(" · ") : "",
        count: recap.newStates.length > 3 ? recap.newStates.length : undefined,
        line: recap.newStates.length > 3 ? recap.newStates.join(" · ") : "first time on your map",
        tone: "#f3e2b0",
      });
    if (recap.counties) out.push({ key: "counties", eyebrow: "New counties", big: "", count: recap.counties, line: recap.towns ? `and ${recap.towns.toLocaleString()} new towns and cities` : "added to your map", tone: "#c4894a" });
    if (stats.topState) out.push({ key: "top", eyebrow: "Your state of the year", big: STATE_NAMES[stats.topState[0]] ?? stats.topState[0], line: `${stats.topState[1].toLocaleString()} visits`, tone: "#3aa0c8" });
    if (stats.topPlace && stats.topPlace.n > 1) out.push({ key: "fav", eyebrow: "You kept going back to", big: stats.topPlace.mark.name, line: `${stats.topPlace.n} visits`, tone: "#d4762c" });
    if (stats.busiest && stats.busiest[1] > 1)
      out.push({
        key: "day",
        eyebrow: "Your biggest day",
        big: new Date(`${stats.busiest[0]}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" }),
        line: `${stats.busiest[1]} places in one day`,
        tone: "#9ed68a",
      });
    if (recap.longestTrail) out.push({ key: "trail", eyebrow: "Longest saved trail", big: recap.longestTrail.name, line: formatMiles(recap.longestTrail.miles), tone: "#9aa7ff" });
    out.push({ key: "end", eyebrow: `${year} in all`, big: "", count: recap.points, line: "points", tone: "#e2b15a" });
    return out;
  }, [recap, stats, name, year]);

  const last = slides.length - 1;
  useEffect(() => {
    if (!slides.length || paused || at >= last) return;
    const timer = window.setTimeout(() => setAt((i) => Math.min(last, i + 1)), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [at, paused, slides.length, last]);

  const slide = slides[at];
  return createPortal(
    <div role="dialog" aria-label={`Your ${year}`} className="screen-top fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[#0f110c] text-ink">
      {/* A soft glow in the slide's color. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/4 left-1/2 size-[140vw] -translate-x-1/2 rounded-full opacity-25 blur-3xl transition-colors duration-700"
        style={{ background: slide?.tone ?? "#e2b15a" }}
      />
      <div className="relative z-10 flex gap-1 px-3 pt-3">
        {slides.map((s, i) => (
          <span key={s.key} className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
            <span
              className="block h-full rounded-full bg-white/80"
              style={
                i < at || (i === at && at === last)
                  ? { width: "100%" }
                  : i === at
                    ? { width: "100%", animation: `year-bar ${SLIDE_MS}ms linear forwards`, animationPlayState: paused ? "paused" : "running" }
                    : { width: "0%" }
              }
            />
          </span>
        ))}
      </div>
      <div className="relative z-10 flex justify-end px-2 pt-1">
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-full text-white/80">
          <X className="size-5" />
        </button>
      </div>

      <div
        className="relative z-10 flex flex-1 select-none flex-col justify-center px-8"
        onPointerDown={() => {
          holdTimer.current = window.setTimeout(() => setPaused(true), 220);
        }}
        onPointerUp={(event) => {
          window.clearTimeout(holdTimer.current);
          if (paused) {
            setPaused(false);
            return;
          }
          const back = event.clientX < window.innerWidth * 0.3;
          setAt((i) => Math.max(0, Math.min(last, i + (back ? -1 : 1))));
        }}
        onPointerCancel={() => {
          window.clearTimeout(holdTimer.current);
          setPaused(false);
        }}
      >
        {error ? <p className="text-center text-sm text-accent">{error}</p> : null}
        {!recap && !error ? <p className="text-center text-sm text-muted">Adding up your year…</p> : null}
        {slide ? (
          <div key={slide.key} className="year-slide">
            <p className="text-sm tracking-[0.2em] uppercase" style={{ color: slide.tone }}>
              {slide.eyebrow}
            </p>
            <p className="mt-3 font-serif text-6xl leading-[1.05] break-words">
              {slide.count != null ? <CountUp to={slide.count} format={(n) => n.toLocaleString()} /> : slide.big}
            </p>
            <p className="mt-3 text-lg text-muted">{slide.line}</p>
          </div>
        ) : null}
      </div>

      {slide && at === last && recap ? (
        <div className="relative z-10 grid grid-cols-2 gap-2 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => setSending(true)} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-medium text-bg">
            <Send className="size-4" aria-hidden />
            Send to a friend
          </button>
          <button type="button" onClick={() => void onShare(recap)} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/25 text-sm">
            <Share2 className="size-4" aria-hidden />
            Share
          </button>
        </div>
      ) : null}
      {sending && recap ? <SendImageSheet label={`Send your ${year}`} makeImage={() => makeCard(recap)} onClose={() => setSending(false)} /> : null}
    </div>,
    document.body,
  );
}
