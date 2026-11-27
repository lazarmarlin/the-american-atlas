/**
 * The modifier cards, drawn like a deck of game cards: the card's color, a
 * white tilted oval in the middle with its picture, the picture again small in
 * two corners. Wild cards are black with a four-color oval.
 */
import type { CSSProperties } from "react";
import { Ban, Beer, Camera, Castle, Coffee, Ghost, Landmark, Library, MapPinned, Sparkles, Spline, Star, Store, TrainFront, Trees, UtensilsCrossed, Waves, type LucideIcon } from "lucide-react";
import { cardById, type CardColor } from "@/lib/square-cards";

const ICONS: Record<string, LucideIcon> = { Ban, Beer, Camera, Castle, Coffee, Ghost, Landmark, Library, MapPinned, Sparkles, Spline, Star, Store, TrainFront, Trees, UtensilsCrossed, Waves };

export const CARD_COLORS: Record<CardColor, string> = {
  red: "#d64a3a",
  yellow: "#e3ad35",
  green: "#3f9a5c",
  blue: "#2f78c0",
  wild: "#1c1915",
};

const WILD_OVAL = `conic-gradient(from 45deg, ${CARD_COLORS.red} 0 25%, ${CARD_COLORS.blue} 0 50%, ${CARD_COLORS.green} 0 75%, ${CARD_COLORS.yellow} 0 100%)`;

/** A card. width in px; the card is 7:10. `dim`: played already. */
export function SquareCardArt({ id, width = 120, dim = false, className = "", style }: { id: string; width?: number; dim?: boolean; className?: string; style?: CSSProperties }) {
  const card = cardById(id);
  if (!card) return null;
  const Icon = ICONS[card.icon] ?? Star;
  const color = CARD_COLORS[card.color];
  const wild = card.color === "wild";
  const h = Math.round((width * 10) / 7);
  const corner = Math.max(8, Math.round(width * 0.13));
  return (
    <div
      role="img"
      aria-label={`${card.name} card: ${card.task}`}
      className={"relative shrink-0 overflow-hidden shadow-md " + className}
      style={{
        width,
        height: h,
        borderRadius: width * 0.1,
        background: color,
        border: `${Math.max(2, width * 0.035)}px solid #fbf8f0`,
        opacity: dim ? 0.55 : 1,
        ...style,
      }}
    >
      {/* The oval. */}
      <div
        className="absolute grid place-items-center"
        style={{
          left: "50%",
          top: "50%",
          width: width * 0.78,
          height: h * 0.72,
          transform: "translate(-50%, -50%) rotate(28deg)",
          borderRadius: "50%",
          background: wild ? WILD_OVAL : "#fbf8f0",
          boxShadow: wild ? "inset 0 0 0 3px #fbf8f0" : undefined,
        }}
      >
        <Icon style={{ transform: "rotate(-28deg)", width: width * 0.38, height: width * 0.38, color: wild ? "#fbf8f0" : color, filter: wild ? "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" : undefined }} strokeWidth={2.2} aria-hidden />
      </div>
      {/* Corners. */}
      <Icon className="absolute" style={{ left: width * 0.07, top: width * 0.07, width: corner, height: corner, color: "#fbf8f0" }} strokeWidth={2.6} aria-hidden />
      <Icon className="absolute" style={{ right: width * 0.07, bottom: width * 0.07, width: corner, height: corner, color: "#fbf8f0", transform: "rotate(180deg)" }} strokeWidth={2.6} aria-hidden />
    </div>
  );
}
