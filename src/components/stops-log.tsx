import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarRange, Calendar, ChevronDown, Map as MapIcon } from "lucide-react";
import { localDay } from "@/lib/drive-log";
import type { Mark } from "@/lib/marks";
import { categoryName, kindFor, placeKinds } from "@/lib/place-kinds";
import { STATE_NAMES } from "@/lib/state-names";
import { pointsForVisit } from "@/lib/visits";

/**
 * Every visit to every place on your map, as a log of stops: grouped by day,
 * week, month or state. A place visited three times is three stops. Visits
 * saved before they carried a date fall back to the day the place was added.
 */

export type StopGroup = "day" | "week" | "month" | "state";

type Stop = {
  key: string;
  mark: Mark;
  /** 0 = first visit. */
  index: number;
  day: string | null;
  points: number;
  note: string;
};

type Section = { key: string; label: string; sub: string; stops: Stop[]; points: number; states: string[] };

const GROUP_KEY = "atlas.stops-group";
const GROUPS: { id: StopGroup; label: string; icon: typeof Calendar }[] = [
  { id: "day", label: "Day", icon: CalendarDays },
  { id: "week", label: "Week", icon: CalendarRange },
  { id: "month", label: "Month", icon: Calendar },
  { id: "state", label: "State", icon: MapIcon },
];
const kindColor = new Map(placeKinds.map((kind) => [kind.id, kind.color]));

/** Noon on that day, local time (so date maths never slips a day). */
const dateOf = (day: string) => new Date(`${day}T12:00:00`);

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function stopsFrom(marks: Mark[]): Stop[] {
  const out: Stop[] = [];
  for (const mark of marks) {
    const visits = mark.visits.length ? mark.visits : [{ id: "first", visitedOn: mark.visitedOn, note: mark.note, photo: mark.photo }];
    visits.forEach((visit, index) => {
      const fallback = index === 0 && mark.addedAt ? localDay(mark.addedAt) : null;
      out.push({
        key: `${mark.id}|${visit.id}|${index}`,
        mark,
        index,
        day: visit.visitedOn ?? fallback,
        points: pointsForVisit(mark.points, index),
        note: visit.note,
      });
    });
  }
  // Newest first; undated at the end.
  return out.sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "") || a.mark.name.localeCompare(b.mark.name));
}

/** Sunday that starts the week of this day. */
function weekStart(day: string) {
  const d = dateOf(day);
  d.setDate(d.getDate() - d.getDay());
  return localDay(d.getTime());
}

function dayLabel(day: string) {
  const today = localDay(Date.now());
  const yesterday = localDay(Date.now() - 86400000);
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  const d = dateOf(day);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

function weekLabel(start: string) {
  const thisWeek = weekStart(localDay(Date.now()));
  const lastWeek = weekStart(localDay(Date.now() - 7 * 86400000));
  if (start === thisWeek) return "This week";
  if (start === lastWeek) return "Last week";
  const a = dateOf(start);
  const b = dateOf(start);
  b.setDate(b.getDate() + 6);
  const sameMonth = a.getMonth() === b.getMonth();
  const year = a.getFullYear() !== new Date().getFullYear() ? `, ${a.getFullYear()}` : "";
  return `${a.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${b.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}${year}`;
}

function monthLabel(key: string) {
  return dateOf(`${key}-15`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function groupStops(stops: Stop[], by: StopGroup): Section[] {
  const map = new Map<string, Stop[]>();
  for (const stop of stops) {
    let key: string;
    if (by === "state") key = stop.mark.state || "—";
    else if (!stop.day) key = "~undated";
    else if (by === "day") key = stop.day;
    else if (by === "week") key = weekStart(stop.day);
    else key = stop.day.slice(0, 7);
    const list = map.get(key);
    if (list) list.push(stop);
    else map.set(key, [stop]);
  }
  const keys = [...map.keys()];
  if (by === "state") keys.sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b));
  else keys.sort((a, b) => (a === "~undated" ? 1 : b === "~undated" ? -1 : b.localeCompare(a)));
  return keys.map((key) => {
    const list = map.get(key) ?? [];
    const states = [...new Set(list.map((stop) => stop.mark.state).filter(Boolean))];
    const label =
      key === "~undated"
        ? "No date"
        : by === "state"
          ? STATE_NAMES[key] ?? key
          : by === "day"
            ? dayLabel(key)
            : by === "week"
              ? weekLabel(key)
              : monthLabel(key);
    let sub = plural(list.length, "stop", "stops");
    if (by === "state") {
      const dated = list.map((stop) => stop.day).filter((day): day is string => !!day).sort();
      if (dated.length) sub += ` · last ${dayLabel(dated[dated.length - 1]!)}`;
    } else if (states.length) {
      sub += ` · ${states.length > 4 ? plural(states.length, "state", "states") : states.join(", ")}`;
    }
    return { key, label, sub, stops: list, points: list.reduce((sum, stop) => sum + stop.points, 0), states };
  });
}

export function StopsLog({ marks, onOpen }: { marks: Mark[]; onOpen: (mark: Mark) => void }) {
  const [by, setBy] = useState<StopGroup>(() => {
    try {
      const saved = localStorage.getItem(GROUP_KEY);
      return GROUPS.some((g) => g.id === saved) ? (saved as StopGroup) : "day";
    } catch {
      return "day";
    }
  });
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(20);
  useEffect(() => {
    try {
      localStorage.setItem(GROUP_KEY, by);
    } catch {
      /* fine */
    }
    setClosed(new Set());
    setShown(20);
  }, [by]);

  const stops = useMemo(() => stopsFrom(marks), [marks]);
  const sections = useMemo(() => groupStops(stops, by), [stops, by]);
  const states = useMemo(() => new Set(stops.map((stop) => stop.mark.state).filter(Boolean)).size, [stops]);
  const first = useMemo(() => stops.map((stop) => stop.day).filter((day): day is string => !!day).sort()[0], [stops]);

  const toggle = (key: string) =>
    setClosed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="px-1">
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-bg/60 p-1" role="tablist" aria-label="Group stops by">
        {GROUPS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={by === id}
            onClick={() => setBy(id)}
            className={
              "flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm transition-colors " +
              (by === id ? "bg-elevated text-ink shadow-sm" : "text-faint active:bg-elevated/50")
            }
          >
            <Icon className={"size-4 " + (by === id ? "text-accent" : "")} aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-muted">
        {plural(stops.length, "stop", "stops")} · {plural(states, "state", "states")}
        {first ? ` · since ${dateOf(first).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : ""}
      </p>

      <div className="mt-2 grid gap-2">
        {sections.slice(0, shown).map((section) => {
          const open = !closed.has(section.key);
          return (
            <section key={section.key} className="overflow-hidden rounded-card border border-line">
              <button
                type="button"
                onClick={() => toggle(section.key)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 bg-surface px-3 py-2.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-lg leading-tight">{section.label}</span>
                  <span className="block truncate text-xs text-muted">{section.sub}</span>
                </span>
                {section.points ? <span className="shrink-0 text-xs font-medium text-accent">+{section.points.toLocaleString()} pts</span> : null}
                <ChevronDown className={"size-4 shrink-0 text-faint transition-transform " + (open ? "rotate-180" : "")} aria-hidden />
              </button>
              {open ? (
                <ul className="divide-y divide-line border-t border-line">
                  {section.stops.map((stop) => {
                    const kind = kindFor(stop.mark.category, stop.mark.name, stop.mark.points, stop.mark.sys);
                    return (
                      <li key={stop.key}>
                        <button type="button" onClick={() => onOpen(stop.mark)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left active:bg-elevated">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: kindColor.get(kind) ?? "#e2b15a" }} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{stop.mark.name}</span>
                            <span className="block truncate text-xs text-muted">
                              {categoryName(stop.mark.category, stop.mark.name)}
                              {by !== "state" ? ` · ${stop.mark.state}` : ""}
                              {stop.index > 0 ? ` · ${ordinal(stop.index + 1)} visit` : ""}
                              {stop.note ? ` · ${stop.note}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            {by !== "day" && stop.day ? <span className="block text-[11px] text-faint">{dayLabel(stop.day)}</span> : null}
                            <span className="block text-xs text-muted">{stop.points ? `${stop.points} pts` : "—"}</span>
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
          Show more ({sections.length - shown} more)
        </button>
      ) : null}
    </div>
  );
}
