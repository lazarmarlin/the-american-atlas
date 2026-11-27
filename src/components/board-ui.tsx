/**
 * Pieces every board screen shares: each kind's look (icon, colour, words),
 * the icon tile, a progress bar, the small uppercase label, and dates and
 * money in words. src/components/boards-page.tsx and the board kinds.
 */
import type { ReactNode } from "react";
import { Beef, ClipboardCheck, Fuel, Grid2x2Check, Grid3x3, HelpCircle, ListTodo, Luggage, Mail, Map as MapIcon, MapPinned, NotebookPen, Receipt, RectangleHorizontal, Star, Store, Timer, Trophy, Type, UtensilsCrossed, Wallet, Wrench } from "lucide-react";
import type { BoardKind } from "@/lib/boards";

type Look = { icon: typeof ListTodo; tint: string; label: string; done: string; doneSection: string; empty: string; add: string };

/** Each kind's icon, colour (used small: the icon tile, checks, and the progress bar), and words. */
export const KIND_LOOK: Record<BoardKind, Look> = {
  todo: { icon: ListTodo, tint: "#8fb47c", label: "To-do", done: "done", doneSection: "Done", empty: "Nothing on the list yet.", add: "Add something to do" },
  pack: { icon: Luggage, tint: "#e0a640", label: "Packing list", done: "packed", doneSection: "In the bag", empty: "Nothing to pack yet.", add: "Add something to pack" },
  trip: { icon: MapIcon, tint: "#e8705f", label: "Trip plan", done: "been", doneSection: "Been", empty: "No stops yet. Add the first one.", add: "Add a stop" },
  wish: { icon: Star, tint: "#c39be6", label: "Wish list", done: "been", doneSection: "Been there", empty: "No places yet. Find one below; it ticks itself off when you get there.", add: "Search for a place" },
  car: { icon: Wrench, tint: "#74aee0", label: "Car care", done: "done", doneSection: "Done", empty: "Nothing to keep track of yet. Pick a few below.", add: "Add a job" },
  split: { icon: Receipt, tint: "#6fc3ad", label: "Split costs", done: "settled", doneSection: "Settled", empty: "No costs yet. Add the first one below.", add: "What was it for?" },
  meals: { icon: UtensilsCrossed, tint: "#e39a6b", label: "Camp meals", done: "got", doneSection: "Got it", empty: "Nothing on the list yet.", add: "Add a meal or something to buy" },
  check: { icon: ClipboardCheck, tint: "#74aee0", label: "Pre-trip check", done: "checked", doneSection: "Checked", empty: "Pick what to check below.", add: "Add something to check" },
  postcards: { icon: Mail, tint: "#d98fb0", label: "Postcards", done: "sent", doneSection: "Sent", empty: "Add who gets one.", add: "Add a name" },
  budget: { icon: Wallet, tint: "#6fc3ad", label: "Trip budget", done: "spent", doneSection: "Spent", empty: "Nothing spent yet.", add: "What was it?" },
  fuel: { icon: Fuel, tint: "#e0a640", label: "Fuel log", done: "filled", doneSection: "Filled", empty: "No fill-ups yet.", add: "Add a fill-up" },
  journal: { icon: NotebookPen, tint: "#c9b37a", label: "Trip journal", done: "written", doneSection: "Written", empty: "Write the first line.", add: "How was today?" },
  bestof: { icon: Trophy, tint: "#e0c050", label: "Best of the trip", done: "picked", doneSection: "Picked", empty: "Add a few categories to pick.", add: "Add a category" },
  plates: { icon: RectangleHorizontal, tint: "#7fb3e6", label: "License plates", done: "spotted", doneSection: "Spotted", empty: "Tap a state when someone spots its plate.", add: "" },
  bingo: { icon: Grid3x3, tint: "#e8705f", label: "Road trip bingo", done: "marked", doneSection: "Marked", empty: "", add: "" },
  alpha: { icon: Type, tint: "#c39be6", label: "Alphabet race", done: "found", doneSection: "Found", empty: "", add: "" },
  cows: { icon: Beef, tint: "#a8c47c", label: "Cow count", done: "counted", doneSection: "Counted", empty: "", add: "" },
  chains: { icon: Store, tint: "#e39a6b", label: "Chain spotting", done: "spotted", doneSection: "Spotted", empty: "Pick a region below.", add: "" },
  guess: { icon: Timer, tint: "#6fc3ad", label: "State line guess", done: "guessed", doneSection: "Rounds", empty: "", add: "" },
  county: { icon: MapPinned, tint: "#74aee0", label: "Name that county", done: "right", doneSection: "Answered", empty: "", add: "" },
  trivia: { icon: HelpCircle, tint: "#e0c050", label: "State trivia", done: "right", doneSection: "Answered", empty: "", add: "" },
  squares: { icon: Grid2x2Check, tint: "#4fae7a", label: "City squares", done: "filled", doneSection: "Filled", empty: "", add: "" },
};

/** The kind's icon on its own soft tile. */

export function BoardKindIcon({ kind, size = "md" }: { kind: BoardKind; size?: "sm" | "md" | "lg" }) {
  const look = KIND_LOOK[kind];
  const Icon = look.icon;
  const box = size === "lg" ? "size-12 rounded-2xl" : size === "sm" ? "size-9 rounded-xl" : "size-11 rounded-xl";
  return (
    <span className={"grid shrink-0 place-items-center " + box} style={{ background: `${look.tint}24`, color: look.tint }}>
      <Icon className={size === "lg" ? "size-6" : size === "sm" ? "size-4" : "size-5"} strokeWidth={1.9} />
    </span>
  );
}

export function itemId() {
  return `bi-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function agoText(ms: number) {
  const gap = Date.now() - ms;
  if (gap < 60_000) return "just now";
  if (gap < 3_600_000) return `${Math.floor(gap / 60_000)}m ago`;
  if (gap < 86_400_000) return `${Math.floor(gap / 3_600_000)}h ago`;
  if (gap < 7 * 86_400_000) return `${Math.floor(gap / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function dayCount(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const a = Date.parse(`${start}T12:00:00`);
  const b = Date.parse(`${end}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function progressWords(kind: BoardKind, done: number, total: number) {
  if (!total) return kind === "trip" ? "No stops yet" : "Empty";
  if (done === total) return kind === "pack" ? "All packed" : kind === "trip" ? "Every stop done" : kind === "wish" ? "Been everywhere on it" : "All done";
  if (kind === "wish") return `${done} of ${total} visited`;
  return kind === "trip" ? `${done} of ${total} stops` : `${done} of ${total} ${KIND_LOOK[kind].done}`;
}

export function Bar({ kind, done, total }: { kind: BoardKind; done: number; total: number }) {
  const share = total ? done / total : 0;
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
      <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.round(share * 100)}%`, background: KIND_LOOK[kind].tint }} />
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="text-[11px] tracking-[0.14em] text-faint uppercase">{children}</p>;
}


export const todayDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function parseMoney(text: string) {
  const n = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

