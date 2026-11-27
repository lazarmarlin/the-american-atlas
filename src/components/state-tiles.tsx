/**
 * The states as a grid of tiles, roughly where they sit on a map. Used by
 * the license plate game and the "Where am I?" guess in chat.
 */
import { STATE_NAMES } from "@/lib/state-names";

/** [abbr, column, row] on an 11 × 8 grid. */
export const STATE_TILES: [string, number, number][] = [
  ["AK", 0, 0], ["ME", 10, 0],
  ["VT", 9, 1], ["NH", 10, 1],
  ["WA", 0, 2], ["ID", 1, 2], ["MT", 2, 2], ["ND", 3, 2], ["MN", 4, 2], ["IL", 5, 2], ["WI", 6, 2], ["MI", 7, 2], ["NY", 8, 2], ["RI", 9, 2], ["MA", 10, 2],
  ["OR", 0, 3], ["NV", 1, 3], ["WY", 2, 3], ["SD", 3, 3], ["IA", 4, 3], ["IN", 5, 3], ["OH", 6, 3], ["PA", 7, 3], ["NJ", 8, 3], ["CT", 9, 3],
  ["CA", 0, 4], ["UT", 1, 4], ["CO", 2, 4], ["NE", 3, 4], ["MO", 4, 4], ["KY", 5, 4], ["WV", 6, 4], ["VA", 7, 4], ["MD", 8, 4], ["DE", 9, 4],
  ["AZ", 1, 5], ["NM", 2, 5], ["KS", 3, 5], ["AR", 4, 5], ["TN", 5, 5], ["NC", 6, 5], ["SC", 7, 5], ["DC", 8, 5],
  ["OK", 3, 6], ["LA", 4, 6], ["MS", 5, 6], ["AL", 6, 6], ["GA", 7, 6],
  ["HI", 0, 7], ["TX", 3, 7], ["FL", 8, 7],
];

export const TILE_NAMES: Record<string, string> = { ...STATE_NAMES, DC: "Washington, D.C." };

/** One tile per state. `look(abbr)` says how each is drawn. */
export function StateTiles({
  onTap,
  look,
  label,
  skip = [],
}: {
  onTap: (abbr: string) => void;
  look: (abbr: string) => { on: boolean; color?: string };
  label?: (abbr: string) => string;
  skip?: string[];
}) {
  return (
    <div className="grid gap-[3px]" style={{ gridTemplateColumns: "repeat(11, minmax(0, 1fr))" }}>
      {Array.from({ length: 8 * 11 }, (_, cell) => {
        const tile = STATE_TILES.find(([abbr, c, r]) => c === cell % 11 && r === Math.floor(cell / 11) && !skip.includes(abbr));
        if (!tile) return <span key={cell} />;
        const [abbr] = tile;
        const { on, color } = look(abbr);
        return (
          <button
            key={abbr}
            type="button"
            aria-pressed={on}
            aria-label={label ? label(abbr) : TILE_NAMES[abbr]}
            onClick={() => onTap(abbr)}
            className={"grid aspect-square place-items-center rounded-[5px] text-[10px] font-medium tracking-tight transition-colors " + (on ? (color ? "text-bg" : "bg-ink text-bg") : "bg-bg/70 text-faint active:bg-elevated")}
            style={on && color ? { background: color } : undefined}
          >
            {abbr}
          </button>
        );
      })}
    </div>
  );
}
