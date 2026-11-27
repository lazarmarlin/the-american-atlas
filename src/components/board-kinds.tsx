/**
 * Board kinds with their own screens: trip budget, fuel log, trip journal,
 * and best of the trip. (Camp meals, the pre-trip check, and postcards are
 * plain lists in boards-page.tsx; the games are in board-games.tsx.)
 */
import { useMemo, useState, type ReactNode } from "react";
import { Crown, Plus, Trash2 } from "lucide-react";
import type { BoardItem, BoardMeta, BoardOpen, BoardPerson } from "@/lib/boards";
import { dayCount, dayLabel, KIND_LOOK, Label, money, parseMoney, todayDay } from "@/components/board-ui";

/** What a board kind's screen can do (from the editor in boards-page.tsx). */
export type BoardApi = {
  board: BoardOpen;
  canEdit: boolean;
  me: string;
  people: BoardPerson[];
  name: (id: string | null | undefined) => string;
  items: () => BoardItem[];
  setItems: (items: BoardItem[]) => void;
  update: (id: string, patch: Partial<BoardItem>) => void;
  add: (text: string, extra?: Partial<BoardItem>) => void;
  remove: (id: string) => void;
  setExtra: (patch: BoardMeta) => void;
  /** The board's own days (trip plan, budget). */
  setDates: (patch: { start?: string | null; end?: string | null }) => void;
};

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={"mx-4 mt-4 rounded-2xl border border-line bg-surface p-4 " + className}>{children}</section>;
}

export function Pill({ on, onClick, children, disabled }: { on?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={"h-9 shrink-0 rounded-full px-3 text-sm disabled:opacity-50 " + (on ? "bg-ink text-bg" : "border border-line text-muted active:bg-elevated")}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col rounded-xl border border-line bg-bg/60 px-3 py-1.5">
      <span className="text-[11px] tracking-[0.14em] text-faint uppercase">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "h-7 min-w-0 bg-transparent text-base outline-none placeholder:text-faint";

/* ---------------------------------------------------------------- budget */

export function BudgetBoard({ api }: { api: BoardApi }) {
  const { board, canEdit } = api;
  const budget = Number(board.doc.extra?.budget) || 0;
  const spent = board.doc.items.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const left = budget - spent;
  const days = dayCount(board.doc.start, board.doc.end);
  const today = todayDay();
  const daysLeft = board.doc.end && board.doc.start ? Math.max(1, dayCount(today > board.doc.start ? today : board.doc.start, board.doc.end) ?? 1) : null;
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const [setting, setSetting] = useState(!budget);
  const [goal, setGoal] = useState(budget ? String(budget / 100) : "");
  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of board.doc.items) map.set(String(item.meta?.day ?? ""), (map.get(String(item.meta?.day ?? "")) ?? 0) + (item.amount ?? 0));
    return [...map].filter(([day]) => day).sort((a, b) => b[0].localeCompare(a[0]));
  }, [board.doc.items]);
  const share = budget ? Math.min(1, spent / budget) : 0;
  const over = budget > 0 && left < 0;
  return (
    <>
      <Card>
        {setting && canEdit ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const cents = parseMoney(goal);
              if (!cents) return;
              api.setExtra({ budget: cents });
              setSetting(false);
            }}
          >
            <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-line bg-bg/60 px-3">
              <span className="text-muted">$</span>
              <input autoFocus inputMode="decimal" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="How much for the whole trip?" className="min-w-0 flex-1 bg-transparent pl-1 text-base outline-none placeholder:text-faint" />
            </div>
            <button type="submit" className="h-11 shrink-0 rounded-lg bg-ink px-4 text-sm text-bg">
              Set
            </button>
          </form>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-serif text-3xl leading-tight tabular-nums">{money(Math.abs(left))}</p>
              {canEdit ? (
                <button type="button" onClick={() => setSetting(true)} className="text-xs text-faint">
                  of {money(budget)} · change
                </button>
              ) : (
                <span className="text-xs text-faint">of {money(budget)}</span>
              )}
            </div>
            <p className={"text-sm " + (over ? "text-ink" : "text-muted")}>{over ? "over budget" : "left"}</p>
            <span className="mt-3 block h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <span className="block h-full rounded-full" style={{ width: `${Math.round(share * 100)}%`, background: over ? "var(--color-accent)" : KIND_LOOK.budget.tint }} />
            </span>
            <p className="mt-2 text-xs text-faint">
              {money(spent)} spent
              {daysLeft && left > 0 ? ` · about ${money(Math.floor(left / daysLeft))} a day for the ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left` : ""}
              {!board.doc.start && days == null ? " · add the trip's days for a daily amount" : ""}
            </p>
          </>
        )}
        {canEdit ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="Leave">
              <input type="date" value={board.doc.start ?? ""} onChange={(event) => api.setDates({ start: event.target.value || null })} className={inputClass} />
            </Field>
            <Field label="Return">
              <input type="date" value={board.doc.end ?? ""} min={board.doc.start ?? undefined} onChange={(event) => api.setDates({ end: event.target.value || null })} className={inputClass} />
            </Field>
          </div>
        ) : null}
      </Card>
      {canEdit ? (
        <form
          className="mx-4 mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const cents = parseMoney(amount);
            if (!cents || !text.trim()) return;
            api.add(text, { amount: cents, by: api.me, at: Date.now(), meta: { day: todayDay() } });
            setText("");
            setAmount("");
          }}
        >
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder="What was it?" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-base outline-none placeholder:text-faint" />
          <div className="flex h-11 w-24 items-center rounded-lg border border-line bg-surface px-2">
            <span className="text-muted">$</span>
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" aria-label="Amount" className="min-w-0 flex-1 bg-transparent pl-1 text-base outline-none placeholder:text-faint" />
          </div>
          <button type="submit" aria-label="Add" disabled={!text.trim() || !parseMoney(amount)} className="grid size-11 shrink-0 place-items-center rounded-lg bg-ink text-bg disabled:bg-elevated disabled:text-faint">
            <Plus className="size-5" />
          </button>
        </form>
      ) : null}
      {byDay.map(([day, total]) => (
        <section key={day} className="mx-4 mt-4">
          <div className="flex items-baseline justify-between">
            <Label>{dayLabel(day)}</Label>
            <span className="text-xs text-faint tabular-nums">{money(total)}</span>
          </div>
          <ul className="mt-1.5 overflow-hidden rounded-2xl border border-line bg-surface">
            {board.doc.items
              .filter((item) => item.meta?.day === day)
              .reverse()
              .map((item) => (
                <li key={item.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-[15px]">{item.text}</span>
                  <span className="shrink-0 tabular-nums">{money(item.amount ?? 0)}</span>
                  {canEdit ? (
                    <button type="button" aria-label={`Remove ${item.text}`} onClick={() => api.remove(item.id)} className="grid size-9 shrink-0 place-items-center text-faint">
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/* -------------------------------------------------------------- fuel log */

export function FuelBoard({ api }: { api: BoardApi }) {
  const { board, canEdit } = api;
  const fills = [...board.doc.items].sort((a, b) => String(b.meta?.day ?? "").localeCompare(String(a.meta?.day ?? "")) || (b.at ?? 0) - (a.at ?? 0));
  const miles = board.fuelMiles ?? {};
  const spent = fills.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const gallons = fills.reduce((sum, item) => sum + (Number(item.meta?.gal) || 0), 0);
  const withMpg = fills.filter((item) => miles[item.id] && Number(item.meta?.gal) > 0);
  const avgMpg = withMpg.length ? withMpg.reduce((sum, item) => sum + miles[item.id], 0) / withMpg.reduce((sum, item) => sum + Number(item.meta?.gal), 0) : null;
  const [gal, setGal] = useState("");
  const [total, setTotal] = useState("");
  const [odo, setOdo] = useState("");
  const [station, setStation] = useState("");
  const cents = parseMoney(total);
  const g = Number(gal.replace(/[^\d.]/g, ""));
  return (
    <>
      <Card>
        <div className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              [avgMpg ? avgMpg.toFixed(1) : "—", "mpg"],
              [money(spent), "spent"],
              [gallons ? `$${(spent / 100 / gallons).toFixed(2)}` : "—", "a gallon"],
            ] as const
          ).map(([value, label]) => (
            <div key={label}>
              <p className="font-serif text-2xl leading-tight tabular-nums">{value}</p>
              <p className="text-[11px] tracking-[0.14em] text-faint uppercase">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-faint">Fill to full each time for good miles per gallon. Miles come from the odometer if you add it, otherwise from tracking.</p>
      </Card>
      {canEdit ? (
        <form
          className="mx-4 mt-4 rounded-2xl border border-line bg-surface p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!cents || !(g > 0)) return;
            const meta: BoardMeta = { day: todayDay(), gal: Math.round(g * 1000) / 1000 };
            const o = Math.round(Number(odo.replace(/[^\d]/g, "")));
            if (o > 0) meta.odo = o;
            api.add(station.trim() || "Fill-up", { amount: cents, by: api.me, at: Date.now(), meta });
            setGal("");
            setTotal("");
            setOdo("");
            setStation("");
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Gallons">
              <input inputMode="decimal" value={gal} onChange={(event) => setGal(event.target.value)} placeholder="12.4" className={inputClass} />
            </Field>
            <Field label="Total $">
              <input inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} placeholder="41.20" className={inputClass} />
            </Field>
            <Field label="Odometer (optional)">
              <input inputMode="numeric" value={odo} onChange={(event) => setOdo(event.target.value)} placeholder="84,310" className={inputClass} />
            </Field>
            <Field label="Where (optional)">
              <input value={station} onChange={(event) => setStation(event.target.value)} placeholder="Buc-ee's, Amarillo" className={inputClass} />
            </Field>
          </div>
          <button type="submit" disabled={!cents || !(g > 0)} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm text-bg disabled:bg-elevated disabled:text-faint">
            <Plus className="size-4" />
            Add fill-up{cents && g > 0 ? ` · $${(cents / 100 / g).toFixed(2)}/gal` : ""}
          </button>
        </form>
      ) : null}
      {fills.length ? (
        <ul className="mx-4 mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
          {fills.map((item) => {
            const gl = Number(item.meta?.gal) || 0;
            const m = miles[item.id];
            return (
              <li key={item.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{item.text}</span>
                  <span className="block truncate text-xs text-faint">
                    {item.meta?.day ? dayLabel(String(item.meta.day)) : ""} · {gl.toFixed(1)} gal{gl ? ` · $${((item.amount ?? 0) / 100 / gl).toFixed(2)}/gal` : ""}
                    {m ? ` · ${m.toLocaleString()} mi` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block tabular-nums">{money(item.amount ?? 0)}</span>
                  {m && gl ? <span className="block text-xs text-muted tabular-nums">{(m / gl).toFixed(1)} mpg</span> : null}
                </span>
                {canEdit ? (
                  <button type="button" aria-label="Remove fill-up" onClick={() => api.remove(item.id)} className="grid size-9 shrink-0 place-items-center text-faint">
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- journal */

export function JournalBoard({ api, placesOn }: { api: BoardApi; placesOn?: (day: string) => number }) {
  const { board } = api;
  const [text, setText] = useState("");
  const [day, setDay] = useState(todayDay());
  const days = useMemo(() => {
    const map = new Map<string, BoardItem[]>();
    for (const item of board.doc.items) {
      const d = String(item.meta?.day ?? "");
      if (!d) continue;
      map.set(d, [...(map.get(d) ?? []), item]);
    }
    return [...map].sort((a, b) => b[0].localeCompare(a[0]));
  }, [board.doc.items]);
  return (
    <>
      <form
        className="mx-4 mt-4 rounded-2xl border border-line bg-surface p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          api.add(text.slice(0, 80), { note: text.slice(80, 220), by: api.me, at: Date.now(), meta: { day } });
          setText("");
        }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, 220))}
          placeholder="How was today? The best bit, the worst bit, the weird bit."
          rows={3}
          className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-base outline-none placeholder:text-faint"
        />
        <div className="mt-2 flex items-center gap-2">
          <label className="relative flex h-10 items-center rounded-full border border-line px-3 text-sm text-muted">
            {day === todayDay() ? "Today" : dayLabel(day)}
            <input type="date" value={day} max={todayDay()} onChange={(event) => setDay(event.target.value || todayDay())} aria-label="Day" className="absolute inset-0 opacity-0" />
          </label>
          <span className="ml-auto text-xs text-faint">{text.length}/220</span>
          <button type="submit" disabled={!text.trim()} className="h-10 rounded-lg bg-ink px-4 text-sm text-bg disabled:bg-elevated disabled:text-faint">
            Write it
          </button>
        </div>
      </form>
      {days.map(([d, entries]) => {
        const n = placesOn?.(d) ?? 0;
        return (
          <section key={d} className="mx-4 mt-5">
            <div className="flex items-baseline gap-2">
              <p className="font-serif text-lg">{dayLabel(d)}</p>
              {n ? <span className="text-xs text-faint">{n} {n === 1 ? "place" : "places"} added</span> : null}
            </div>
            <ul className="mt-1.5 grid gap-2">
              {entries.map((item) => (
                <li key={item.id} className="rounded-2xl border border-line bg-surface px-3 py-2.5">
                  <p className="text-[15px] leading-snug whitespace-pre-wrap">{item.text + item.note}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-faint">
                    <span>{api.name(item.by)}</span>
                    {(api.canEdit || item.by === api.me) ? (
                      <button type="button" onClick={() => api.remove(item.id)} className="ml-auto">
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/* ----------------------------------------------------------- best of the trip */

const BEST_CATS = ["Best meal", "Best view", "Best stop", "Funniest moment", "Best song", "Worst motel", "Weirdest sign", "Best coffee"];

export function BestOfBoard({ api }: { api: BoardApi }) {
  const { board, canEdit } = api;
  const cats = board.doc.items.filter((item) => item.meta?.cat === true);
  const picks = board.doc.items.filter((item) => item.meta?.cat !== true);
  const [cat, setCat] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const have = new Set(cats.map((item) => item.text.toLowerCase()));
  return (
    <>
      {cats.map((category) => {
        const mine = picks.find((item) => item.meta?.of === category.id && item.by === api.me);
        const theirs = picks.filter((item) => item.meta?.of === category.id);
        const winner = theirs.find((item) => item.done);
        return (
          <Card key={category.id}>
            <div className="flex items-baseline gap-2">
              <p className="min-w-0 flex-1 font-serif text-xl leading-tight">{category.text}</p>
              {canEdit ? (
                <button type="button" aria-label={`Remove ${category.text}`} onClick={() => api.setItems(api.items().filter((item) => item.id !== category.id && item.meta?.of !== category.id))} className="text-faint">
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
            {theirs.length ? (
              <ul className="mt-2 grid gap-1.5">
                {theirs.map((item) => (
                  <li key={item.id} className={"flex items-center gap-2 rounded-xl px-3 py-2 " + (item.done ? "bg-ink/10" : "bg-bg/60")}>
                    {item.done ? <Crown className="size-4 shrink-0" style={{ color: KIND_LOOK.bestof.tint }} aria-label="The winner" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px]">{item.text}</span>
                      <span className="block text-xs text-faint">{api.name(item.by)}</span>
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => api.setItems(api.items().map((row) => (row.meta?.of === category.id ? { ...row, done: row.id === item.id ? !item.done : false } : row)))}
                        className={"h-8 shrink-0 rounded-full px-3 text-xs " + (item.done ? "bg-ink text-bg" : "border border-line text-muted")}
                      >
                        {item.done ? "Winner" : "Crown it"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = (drafts[category.id] ?? "").trim();
                if (!text) return;
                if (mine) api.update(mine.id, { text: text.slice(0, 80) });
                else api.add(text, { by: api.me, at: Date.now(), meta: { of: category.id } });
                setDrafts((cur) => ({ ...cur, [category.id]: "" }));
              }}
            >
              <input
                value={drafts[category.id] ?? ""}
                onChange={(event) => setDrafts((cur) => ({ ...cur, [category.id]: event.target.value }))}
                placeholder={mine ? `Your pick: ${mine.text} (change it)` : "Your pick"}
                className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-base outline-none placeholder:text-faint"
              />
              <button type="submit" disabled={!(drafts[category.id] ?? "").trim()} className="h-10 shrink-0 rounded-lg bg-ink px-3 text-sm text-bg disabled:bg-elevated disabled:text-faint">
                {mine ? "Change" : "Pick"}
              </button>
            </form>
            {winner ? null : theirs.length > 1 && canEdit ? <p className="mt-1.5 text-xs text-faint">Crown the winner once everyone's picked.</p> : null}
          </Card>
        );
      })}
      {canEdit ? (
        <div className="mx-4 mt-4">
          <form
            className="flex items-center gap-1 rounded-full border border-line bg-surface py-1 pr-1 pl-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!cat.trim()) return;
              api.add(cat, { meta: { cat: true } });
              setCat("");
            }}
          >
            <input value={cat} onChange={(event) => setCat(event.target.value)} placeholder="Add a category" className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint" />
            <button type="submit" aria-label="Add category" disabled={!cat.trim()} className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-bg disabled:bg-elevated disabled:text-faint">
              <Plus className="size-5" />
            </button>
          </form>
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
            {BEST_CATS.filter((name) => !have.has(name.toLowerCase())).map((name) => (
              <button key={name} type="button" onClick={() => api.add(name, { meta: { cat: true } })} className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-3 text-sm text-muted">
                <Plus className="size-3.5" />
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
