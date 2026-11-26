import { useEffect, useMemo, useState } from "react";
import { Calendar, CalendarDays, CalendarRange, ChevronDown, CircleParking, Download, Map as MapIcon, MapPinned, X } from "lucide-react";
import { localDay } from "@/lib/drive-log";
import type { Mark } from "@/lib/marks";
import { listPhotos } from "@/lib/photos";
import { categoryName, kindFor, placeKinds } from "@/lib/place-kinds";
import { shareTextFile } from "@/lib/share-file";
import { STATE_NAMES } from "@/lib/state-names";
import type { GpsStop } from "@/lib/stops";
import { pointsForVisit } from "@/lib/visits";

/**
 * Your travel log: every visit to every place on your map, and every stop
 * found from GPS while tracking (somewhere you stayed 10+ minutes), grouped
 * by day, week, month or state. A place visited three times is three
 * entries. Visits saved before they carried a date fall back to the day the
 * place was added.
 */

export type StopGroup = "day" | "week" | "month" | "state";
type Show = "all" | "places" | "stops";

type Entry =
  | { type: "visit"; key: string; mark: Mark; index: number; day: string | null; sort: number; points: number; note: string; state: string; photo: string }
  | { type: "gps"; key: string; stop: GpsStop; day: string; sort: number; points: 0; state: string };

type Section = { key: string; label: string; sub: string; entries: Entry[]; points: number };

const GROUP_KEY = "atlas.stops-group";
const SHOW_KEY = "atlas.stops-show";
const GROUPS: { id: StopGroup; label: string; icon: typeof Calendar }[] = [
  { id: "day", label: "Day", icon: CalendarDays },
  { id: "week", label: "Week", icon: CalendarRange },
  { id: "month", label: "Month", icon: Calendar },
  { id: "state", label: "State", icon: MapIcon },
];
const kindColor = new Map(placeKinds.map((kind) => [kind.id, kind.color]));
const STOP_COLOR = "#9aa7ff";

/** Noon on that day, local time (so date maths never slips a day). */
const dateOf = (day: string) => new Date(`${day}T12:00:00`);

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return allowed.includes(saved as T) ? (saved as T) : fallback;
  } catch {
    return fallback;
  }
}

function entriesFrom(marks: Mark[], stops: GpsStop[]): Entry[] {
  const out: Entry[] = [];
  for (const mark of marks) {
    const visits = mark.visits.length ? mark.visits : [{ id: "first", visitedOn: mark.visitedOn, note: mark.note, photo: mark.photo }];
    visits.forEach((visit, index) => {
      const day = visit.visitedOn ?? (index === 0 && mark.addedAt ? localDay(mark.addedAt) : null);
      out.push({
        type: "visit",
        key: `${mark.id}|${visit.id}|${index}`,
        mark,
        index,
        day,
        // Places have a day but no time: they sort at midday.
        sort: day ? dateOf(day).getTime() : 0,
        points: pointsForVisit(mark.points, index),
        note: visit.note,
        state: mark.state,
        photo: visit.photo,
      });
    });
  }
  for (const stop of stops) {
    out.push({ type: "gps", key: stop.id, stop, day: localDay(stop.start), sort: stop.start, points: 0, state: stop.state });
  }
  return out.sort((a, b) => b.sort - a.sort);
}

/** Sunday that starts the week of this day. */
function weekStart(day: string) {
  const d = dateOf(day);
  d.setDate(d.getDate() - d.getDay());
  return localDay(d.getTime());
}

function dayLabel(day: string) {
  if (day === localDay(Date.now())) return "Today";
  if (day === localDay(Date.now() - 86400000)) return "Yesterday";
  const d = dateOf(day);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

function weekLabel(start: string) {
  if (start === weekStart(localDay(Date.now()))) return "This week";
  if (start === weekStart(localDay(Date.now() - 7 * 86400000))) return "Last week";
  const a = dateOf(start);
  const b = dateOf(start);
  b.setDate(b.getDate() + 6);
  const year = a.getFullYear() !== new Date().getFullYear() ? `, ${a.getFullYear()}` : "";
  return `${a.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${b.toLocaleDateString(undefined, a.getMonth() === b.getMonth() ? { day: "numeric" } : { month: "short", day: "numeric" })}${year}`;
}

const monthLabel = (key: string) => dateOf(`${key}-15`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function duration(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function counts(entries: Entry[]) {
  const places = entries.filter((e) => e.type === "visit").length;
  const stops = entries.length - places;
  return [places ? plural(places, "place", "places") : "", stops ? plural(stops, "stop", "stops") : ""].filter(Boolean).join(" · ") || "Nothing";
}

function groupEntries(entries: Entry[], by: StopGroup): Section[] {
  const map = new Map<string, Entry[]>();
  for (const entry of entries) {
    let key: string;
    if (by === "state") key = entry.state || "—";
    else if (!entry.day) key = "~undated";
    else if (by === "day") key = entry.day;
    else if (by === "week") key = weekStart(entry.day);
    else key = entry.day.slice(0, 7);
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  const keys = [...map.keys()];
  if (by === "state") keys.sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b));
  else keys.sort((a, b) => (a === "~undated" ? 1 : b === "~undated" ? -1 : b.localeCompare(a)));
  return keys.map((key) => {
    const list = map.get(key) ?? [];
    const states = [...new Set(list.map((e) => e.state).filter(Boolean))];
    const label =
      key === "~undated" ? "No date" : by === "state" ? (STATE_NAMES[key] ?? key) : by === "day" ? dayLabel(key) : by === "week" ? weekLabel(key) : monthLabel(key);
    let sub = counts(list);
    if (by === "state") {
      const last = list.map((e) => e.day).filter((d): d is string => !!d).sort().at(-1);
      if (last) sub += ` · last ${dayLabel(last)}`;
    } else if (states.length) {
      sub += ` · ${states.length > 4 ? plural(states.length, "state", "states") : states.join(", ")}`;
    }
    return { key, label, sub, entries: list, points: list.reduce((sum, e) => sum + e.points, 0) };
  });
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function toCsv(entries: Entry[]) {
  const head = ["Date", "Time", "Type", "Name", "Kind", "State", "Visit", "Points", "Minutes", "Latitude", "Longitude", "Note"];
  const rows = [...entries]
    .sort((a, b) => a.sort - b.sort)
    .map((e) =>
      e.type === "visit"
        ? [e.day ?? "", "", "Place", e.mark.name, categoryName(e.mark.category, e.mark.name), e.state, e.index + 1, e.points, "", e.mark.lat ?? "", e.mark.lon ?? "", e.note]
        : [e.day, clock(e.stop.start), "Stop", e.stop.label, "", e.state, "", "", Math.round((e.stop.end - e.stop.start) / 60_000), e.stop.lat, e.stop.lon, ""],
    );
  return [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

/** One spot of a group on the map: a place (ringed in its own color) or a GPS stop. */
export type GroupSpot = { id: string; lon: number; lat: number; kind: "place" | "stop"; color: string; name: string; sub: string };

/** The group's spots, oldest first; a place visited more than once is one spot. */
function spotsOf(entries: Entry[]): GroupSpot[] {
  const seen = new Set<string>();
  const out: GroupSpot[] = [];
  for (const e of [...entries].sort((a, b) => a.sort - b.sort)) {
    if (e.type === "gps") {
      const s = e.stop;
      out.push({ id: s.id, lon: s.lon, lat: s.lat, kind: "stop", color: STOP_COLOR, name: s.label, sub: `${dayLabel(e.day)} · ${clock(s.start)} · ${duration(s.end - s.start)}` });
    } else if (e.mark.lat != null && e.mark.lon != null && !seen.has(e.mark.id)) {
      seen.add(e.mark.id);
      const kind = kindFor(e.mark.category, e.mark.name, e.mark.points, e.mark.sys);
      out.push({
        id: e.mark.id,
        lon: e.mark.lon,
        lat: e.mark.lat,
        kind: "place",
        color: kindColor.get(kind) ?? "#e2b15a",
        name: e.mark.name,
        sub: `${categoryName(e.mark.category, e.mark.name)} · ${e.state}`,
      });
    }
  }
  return out;
}

export function StopsLog({
  marks,
  gpsStops = [],
  onOpen,
  onShowOnMap,
  onRemoveStop,
}: {
  marks: Mark[];
  gpsStops?: GpsStop[];
  onOpen: (mark: Mark) => void;
  /** Show a group's spots on the map, under this label. */
  onShowOnMap?: (label: string, spots: GroupSpot[]) => void;
  onRemoveStop?: (id: string) => void;
}) {
  const [by, setBy] = useState<StopGroup>(() => readPref(GROUP_KEY, ["day", "week", "month", "state"] as const, "day"));
  const [show, setShow] = useState<Show>(() => readPref(SHOW_KEY, ["all", "places", "stops"] as const, "all"));
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(20);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(GROUP_KEY, by);
      localStorage.setItem(SHOW_KEY, show);
    } catch {
      /* fine */
    }
    setClosed(new Set());
    setShown(20);
  }, [by, show]);

  // Photos matched to your places: one taken there that day shows on the visit.
  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    listPhotos()
      .then((rows) => {
        if (!live) return;
        const map = new Map<string, string>();
        for (const row of rows) {
          if (!row.takenAt || !row.thumb) continue;
          const key = `${row.poiId}|${localDay(row.takenAt)}`;
          if (!map.has(key)) map.set(key, row.thumb);
        }
        setPhotos(map);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const all = useMemo(() => entriesFrom(marks, gpsStops), [marks, gpsStops]);
  const entries = useMemo(() => (show === "all" ? all : all.filter((e) => (show === "places" ? e.type === "visit" : e.type === "gps"))), [all, show]);
  const sections = useMemo(() => groupEntries(entries, by), [entries, by]);
  const states = useMemo(() => new Set(entries.map((e) => e.state).filter(Boolean)).size, [entries]);

  const toggle = (key: string) =>
    setClosed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function exportCsv() {
    setNote(null);
    try {
      const result = await shareTextFile(`atlas-stops-${localDay(Date.now())}.csv`, toCsv(entries), "text/csv", "Your travel log");
      if (result === "saved") setNote("Downloaded.");
    } catch (err) {
      if (!(err instanceof Error && /cancel/i.test(err.message))) setNote("Couldn't export.");
    }
  }

  return (
    <div className="px-1">
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-bg/60 p-1" role="tablist" aria-label="Group by">
        {GROUPS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={by === id}
            onClick={() => setBy(id)}
            className={"flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm transition-colors " + (by === id ? "bg-elevated text-ink shadow-sm" : "text-faint active:bg-elevated/50")}
          >
            <Icon className={"size-4 " + (by === id ? "text-accent" : "")} aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {(
          [
            ["all", "All"],
            ["places", "Places"],
            ["stops", "Stops"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={show === id}
            onClick={() => setShow(id)}
            className={"h-8 rounded-full px-3 text-xs " + (show === id ? "bg-elevated text-ink" : "text-faint")}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={!entries.length}
          className="ml-auto flex h-8 items-center gap-1 rounded-full border border-line px-3 text-xs text-muted disabled:opacity-40"
        >
          <Download className="size-3.5" aria-hidden />
          Export
        </button>
      </div>
      <p className="mt-2 px-1 text-xs text-muted">
        {counts(entries)} · {plural(states, "state", "states")}
      </p>
      {note ? <p className="mt-1 px-1 text-xs text-muted">{note}</p> : null}
      {show === "stops" && !entries.length ? (
        <p className="mt-3 px-1 text-sm text-muted">With tracking on, anywhere you stay 10 minutes or more shows up here.</p>
      ) : null}

      <div className="mt-2 grid gap-2">
        {sections.slice(0, shown).map((section) => {
          const open = !closed.has(section.key);
          const spots = spotsOf(section.entries);
          return (
            <section key={section.key} className="overflow-hidden rounded-card border border-line">
              <div className="flex items-center bg-surface">
                <button type="button" onClick={() => toggle(section.key)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-lg leading-tight">{section.label}</span>
                    <span className="block truncate text-xs text-muted">{section.sub}</span>
                  </span>
                  {section.points ? <span className="shrink-0 text-xs font-medium text-accent">+{section.points.toLocaleString()} pts</span> : null}
                  <ChevronDown className={"size-4 shrink-0 text-faint transition-transform " + (open ? "rotate-180" : "")} aria-hidden />
                </button>
                {onShowOnMap && spots.length ? (
                  <button
                    type="button"
                    onClick={() => onShowOnMap(section.label, spots)}
                    aria-label={`Show ${section.label} on the map`}
                    className="grid h-11 w-11 shrink-0 place-items-center text-muted active:text-ink"
                  >
                    <MapPinned className="size-[18px]" aria-hidden />
                  </button>
                ) : null}
              </div>
              {open ? (
                <ul className="divide-y divide-line border-t border-line">
                  {section.entries.map((entry) => {
                    if (entry.type === "gps") {
                      const s = entry.stop;
                      return (
                        <li key={entry.key} className="flex items-center">
                          <button
                            type="button"
                            onClick={() => onShowOnMap?.(s.label, spotsOf([entry]))}
                            className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left active:bg-elevated"
                          >
                            <CircleParking className="size-4 shrink-0" style={{ color: STOP_COLOR }} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{s.label}</span>
                              <span className="block truncate text-xs text-muted">
                                {clock(s.start)} · {duration(s.end - s.start)}
                                {by !== "state" && s.state ? ` · ${s.state}` : ""}
                              </span>
                            </span>
                            {by !== "day" ? <span className="shrink-0 text-[11px] text-faint">{dayLabel(entry.day)}</span> : null}
                          </button>
                          {onRemoveStop ? (
                            <button type="button" onClick={() => onRemoveStop(s.id)} aria-label={`Remove the stop at ${s.label}`} className="grid h-12 w-10 shrink-0 place-items-center text-faint active:text-ink">
                              <X className="size-3.5" aria-hidden />
                            </button>
                          ) : null}
                        </li>
                      );
                    }
                    const kind = kindFor(entry.mark.category, entry.mark.name, entry.mark.points, entry.mark.sys);
                    return (
                      <li key={entry.key}>
                        <button type="button" onClick={() => onOpen(entry.mark)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left active:bg-elevated">
                          <span className="mx-[3px] size-2.5 shrink-0 rounded-full" style={{ background: kindColor.get(kind) ?? "#e2b15a" }} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{entry.mark.name}</span>
                            <span className="block truncate text-xs text-muted">
                              {categoryName(entry.mark.category, entry.mark.name)}
                              {by !== "state" ? ` · ${entry.state}` : ""}
                              {entry.index > 0 ? ` · ${ordinal(entry.index + 1)} visit` : ""}
                              {entry.note ? ` · ${entry.note}` : ""}
                            </span>
                          </span>
                          {(() => {
                            const pic = entry.photo || (entry.day ? photos.get(`${entry.mark.id}|${entry.day}`) : undefined);
                            return pic ? <img src={pic} alt="" className="size-9 shrink-0 rounded-md object-cover" /> : null;
                          })()}
                          <span className="shrink-0 text-right">
                            {by !== "day" && entry.day ? <span className="block text-[11px] text-faint">{dayLabel(entry.day)}</span> : null}
                            <span className="block text-xs text-muted">{entry.points ? `${entry.points} pts` : "—"}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
      {sections.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + 30)} className="mt-2 h-11 w-full rounded-lg border border-line text-sm text-muted">
          Show more ({sections.length - shown})
        </button>
      ) : null}
    </div>
  );
}
