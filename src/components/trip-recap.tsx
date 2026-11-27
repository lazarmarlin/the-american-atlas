import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "@/components/screen-header";
import { createPortal } from "react-dom";
import { useBackClose } from "@/lib/sheet-back";
import { listFriends, type FriendRow } from "@/lib/friends";
import { listGroups, type ChatGroup } from "@/lib/chat-groups";
import { sendToThread, type Thread } from "@/lib/messages";
import { tripTrack, type Trip, type TripCard } from "@/lib/trips";

export type { TripCard };
import { thinLines, trackLines, trackMiles, waitingPoints } from "@/lib/trip-track";
import { localDay } from "@/lib/drive-log";
import { pointsForVisit } from "@/lib/visits";
import type { Mark } from "@/lib/marks";


// ---------------------------------------------------------------- sketch

type StateShape = { abbr: string; rings: [number, number][][] };
let statesPromise: Promise<StateShape[]> | null = null;

function loadStateShapes() {
  statesPromise ??= fetch("/atlas/states.geojson")
    .then((res) => res.json())
    .then((geo: { features: { properties: { abbr: string }; geometry: { type: string; coordinates: unknown } }[] }) =>
      geo.features.map((f) => ({
        abbr: f.properties.abbr,
        rings:
          f.geometry.type === "Polygon"
            ? (f.geometry.coordinates as [number, number][][])
            : (f.geometry.coordinates as [number, number][][][]).flat(),
      })),
    )
    .catch(() => {
      statesPromise = null;
      return [];
    });
  return statesPromise;
}

/** A small drawing of a trip: state lines for context, the route, and the stops. */
export function TripSketch({ lines, dots, height = 190 }: { lines: [number, number][][]; dots: [number, number, number][]; height?: number }) {
  const [states, setStates] = useState<StateShape[]>([]);
  useEffect(() => {
    let dead = false;
    void loadStateShapes().then((rows) => {
      if (!dead) setStates(rows);
    });
    return () => {
      dead = true;
    };
  }, []);
  const view = useMemo(() => {
    const all = [...lines.flat(), ...dots.map((d) => [d[0], d[1]] as [number, number])];
    if (!all.length) return null;
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const [lon, lat] of all) {
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
    // At least ~30 miles across, so one stop still shows its surroundings.
    const pad = Math.max(0.25, (e - w) * 0.12, (n - s) * 0.12);
    w -= pad;
    e += pad;
    s -= pad;
    n += pad;
    const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
    const width = 320;
    const scale = Math.min(width / ((e - w) * k), height / (n - s));
    const ox = (width - (e - w) * k * scale) / 2;
    const oy = (height - (n - s) * scale) / 2;
    const xy = (lon: number, lat: number) => [ox + (lon - w) * k * scale, oy + (n - lat) * scale] as const;
    return { xy, w, s, e, n, width };
  }, [lines, dots, height]);
  if (!view) return <div className="grid place-items-center rounded-lg border border-line text-sm text-faint" style={{ height }}>No route yet</div>;
  const path = (line: [number, number][]) => line.map(([lon, lat], i) => `${i ? "L" : "M"}${view.xy(lon, lat).map((v) => v.toFixed(1)).join(" ")}`).join("");
  const near = states.filter((st) =>
    st.rings.some((ring) => ring.some(([lon, lat]) => lon > view.w - 4 && lon < view.e + 4 && lat > view.s - 4 && lat < view.n + 4)),
  );
  return (
    <svg viewBox={`0 0 ${view.width} ${height}`} className="w-full rounded-lg border border-line bg-bg" role="img" aria-label="Map of the trip">
      {near.map((st) => (
        <path key={st.abbr} d={st.rings.map((ring) => path(ring) + "Z").join("")} fill="none" stroke="var(--color-line)" strokeWidth={1} />
      ))}
      {lines.map((line, i) => (
        <path key={i} d={path(line)} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {(() => {
        const first = lines[0]?.[0];
        const lastLine = lines.at(-1);
        const end = lastLine?.at(-1);
        if (!first || !end) return null;
        const [sx, sy] = view.xy(first[0], first[1]);
        const [ex, ey] = view.xy(end[0], end[1]);
        return (
          <g>
            <circle cx={sx} cy={sy} r={5} fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth={2.5} />
            <circle cx={ex} cy={ey} r={5} fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth={1.5} />
          </g>
        );
      })()}
      {dots.map(([lon, lat, fresh], i) => {
        const [x, y] = view.xy(lon, lat);
        return <circle key={i} cx={x} cy={y} r={fresh ? 3.5 : 2.5} fill={fresh ? "var(--color-ink)" : "var(--color-faint)"} stroke="var(--color-bg)" strokeWidth={1} />;
      })}
    </svg>
  );
}

export function TripStats({ card }: { card: TripCard }) {
  const stat = (n: string | number, label: string) => (
    <div className="rounded-lg border border-line px-2 py-2 text-center">
      <p className="font-serif text-xl leading-tight">{n}</p>
      <p className="text-[11px] tracking-wide text-faint uppercase">{label}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      {stat(Math.round(card.miles).toLocaleString(), "miles")}
      {stat(card.fresh, card.fresh === 1 ? "new place" : "new places")}
      {stat(card.points.toLocaleString(), "points")}
      {stat(card.places, card.places === 1 ? "stop" : "stops")}
      {stat(card.counties, card.counties === 1 ? "county" : "counties")}
      {stat(card.states.length, card.states.length === 1 ? "state" : "states")}
    </div>
  );
}

export function tripDates(card: { from: string | null; to: string | null }) {
  if (!card.from) return "";
  const fmt = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return card.to && card.to !== card.from ? `${fmt(card.from)} – ${fmt(card.to)}` : fmt(card.from);
}

// ---------------------------------------------------------------- recap

/** Work out a trip's recap from its stops, your places, and its route. */
export async function buildTripCard(trip: Trip, marks: Mark[]): Promise<TripCard> {
  const track = [...(await tripTrack({ data: trip.id }).catch(() => [])), ...waitingPoints(trip.id)].sort((a, b) => a[2] - b[2]);
  const from = trip.startedAt ? localDay(trip.startedAt) : null;
  const to = from ? localDay(trip.endedAt ?? Date.now()) : null;
  const byId = new Map(marks.map((mark) => [mark.id, mark]));
  const stops = [...new Set(trip.stops.map((stop) => stop.poiId))].map((id) => byId.get(id)).filter((mark): mark is Mark => !!mark);
  const inTrip = (day: string | null | undefined) => !from || (!!day && day >= from && (!to || day <= to));
  let fresh = 0;
  let points = 0;
  const dots: [number, number, number][] = [];
  for (const mark of stops) {
    const days = mark.visits.map((visit) => visit.visitedOn).filter((day): day is string => !!day).sort();
    const isNew = !from || !days.length || days[0]! >= from;
    if (isNew) fresh += 1;
    mark.visits
      .map((visit) => visit.visitedOn)
      .forEach((day, index) => {
        if (inTrip(day)) points += pointsForVisit(mark.points, index);
      });
    // A road's point is just somewhere along it, often far from where you drove it.
    if (mark.lat != null && mark.lon != null && !mark.id.startsWith("r:")) dots.push([mark.lon, mark.lat, isNew ? 1 : 0]);
  }
  const lines = trackLines(track);
  return {
    name: trip.name,
    from,
    to,
    miles: Math.round(trackMiles(track) * 10) / 10,
    places: stops.length,
    fresh,
    states: [...new Set(stops.map((mark) => mark.state))].sort(),
    counties: stops.filter((mark) => mark.category === "county").length,
    points: Math.round(points),
    lines: thinLines(lines, 400),
    dots: dots.slice(0, 200),
  };
}

export function TripRecap({
  trip,
  marks,
  justEnded,
  onShowMap,
  onClose,
}: {
  trip: Trip;
  marks: Mark[];
  justEnded?: boolean;
  onShowMap: (card: TripCard) => void;
  onClose: () => void;
}) {
  const [card, setCard] = useState<TripCard | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let dead = false;
    void buildTripCard(trip, marks).then((next) => {
      if (!dead) setCard(next);
    });
    return () => {
      dead = true;
    };
    // Built once per opening; places added afterwards show next time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);
  useBackClose(onClose);
  return createPortal(
    <div role="dialog" aria-label={`${trip.name} recap`} className="screen-top fixed inset-0 z-40 flex flex-col bg-bg">
      <ScreenHeader eyebrow={justEnded ? "Trip ended" : "Trip recap"} title={trip.name} onBack={onClose} />
      <div className="safe-bottom min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {card ? (
          <>
            {card.from ? <p className="mb-2 text-sm text-muted">{tripDates(card)}</p> : null}
            <TripSketch lines={card.lines} dots={card.dots} height={210} />
            <div className="mt-3">
              <TripStats card={card} />
            </div>
            {card.states.length ? <p className="mt-3 text-sm text-muted">Through {card.states.join(", ")}.</p> : null}
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => onShowMap(card)} className="h-12 w-full rounded-lg border border-ink bg-elevated text-sm">
                Show on the map
              </button>
              <button type="button" onClick={() => setSending(true)} className="h-12 w-full rounded-lg border border-line text-sm">
                Send to a chat
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Adding it up…</p>
        )}
      </div>
      {sending && card ? <SendTripSheet card={card} onClose={() => setSending(false)} /> : null}
    </div>,
    document.body,
  );
}

function SendTripSheet({ card, onClose }: { card: TripCard; onClose: () => void }) {
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([listFriends().catch(() => []), listGroups().catch(() => [])]).then(([f, g]) => {
      setFriends(f);
      setGroups(g);
    });
  }, []);
  useBackClose(onClose);
  async function send(thread: Thread, label: string) {
    setBusy(true);
    try {
      await sendToThread({ data: { thread, id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, kind: "trip", trip: card } });
      setNote(`Sent to ${label}.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send it.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div className="safe-bottom max-h-[70dvh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-surface px-4 pt-4" onClick={(event) => event.stopPropagation()}>
        <p className="font-serif text-xl">Send the recap</p>
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
        {friends === null ? <p className="mt-2 text-sm text-muted">Loading…</p> : null}
        {friends && !friends.length && !groups.length ? <p className="mt-2 text-sm text-muted">Add a friend first, then you can send them trips.</p> : null}
        <ul className="mt-2 grid gap-2">
          {groups.map((group) => (
            <li key={group.id}>
              <button type="button" disabled={busy} onClick={() => void send({ kind: "group", id: group.id }, group.name)} className="h-11 w-full rounded-lg border border-line px-3 text-left text-sm">
                {group.name} <span className="text-faint">· trip chat</span>
              </button>
            </li>
          ))}
          {friends?.map((friend) => (
            <li key={friend.id}>
              <button type="button" disabled={busy} onClick={() => void send({ kind: "friend", id: friend.id }, friend.name)} className="h-11 w-full rounded-lg border border-line px-3 text-left text-sm">
                {friend.name}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onClose} className="mt-3 mb-1 h-11 w-full text-sm text-muted">
          Done
        </button>
      </div>
    </div>
  );
}
