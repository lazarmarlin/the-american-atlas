/** Chat stickers: what they're called and how they move. The art is in components/chat-stickers.tsx. */

export type StickerMotion = "bounce" | "wobble" | "shake" | "float" | "spin" | "pop";

export type StickerInfo = {
  id: string;
  /** What it says, for previews, notifications and screen readers. */
  label: string;
  /** Shown instead, by a server that doesn't know stickers yet. */
  emoji: string;
  motion: StickerMotion;
  /** Drawn with the sender's own map avatar in it. */
  you?: boolean;
};

export const STICKERS: StickerInfo[] = [
  // You: your map avatar, doing things.
  { id: "me-hi", label: "Hi!", emoji: "👋", motion: "wobble", you: true },
  { id: "me-omw", label: "On my way", emoji: "🚗", motion: "bounce", you: true },
  { id: "me-love", label: "Love you", emoji: "💕", motion: "float", you: true },
  { id: "me-what", label: "What?!", emoji: "😳", motion: "shake", you: true },
  { id: "me-party", label: "Party", emoji: "🥳", motion: "pop", you: true },
  { id: "me-sleepy", label: "Sleepy", emoji: "😴", motion: "float", you: true },
  { id: "me-brb", label: "BRB", emoji: "🏃", motion: "wobble", you: true },
  { id: "me-here", label: "Made it!", emoji: "📍", motion: "bounce", you: true },
  // The road.
  { id: "road-trip", label: "Road trip!", emoji: "🚙", motion: "bounce" },
  { id: "hangry", label: "Hangry", emoji: "🌮", motion: "shake" },
  { id: "snack-stop", label: "Snack stop", emoji: "🌭", motion: "wobble" },
  { id: "lost", label: "Lost", emoji: "🗺️", motion: "spin" },
  { id: "yeehaw", label: "Yeehaw", emoji: "🤠", motion: "wobble" },
  { id: "lol", label: "LOL", emoji: "😂", motion: "shake" },
  { id: "nope", label: "Nope", emoji: "🦝", motion: "shake" },
  { id: "gas-money", label: "Gas money?", emoji: "⛽", motion: "wobble" },
  { id: "wish-here", label: "Wish you were here", emoji: "💌", motion: "float" },
  { id: "big-mood", label: "Big mood", emoji: "🦬", motion: "bounce" },
  { id: "coffee", label: "Coffee pls", emoji: "☕", motion: "float" },
  { id: "traffic", label: "Ugh, traffic", emoji: "🚦", motion: "shake" },
  { id: "squirrel", label: "Squirrel!", emoji: "🐿️", motion: "pop" },
  { id: "bucket-list", label: "Bucket list ✓", emoji: "✅", motion: "pop" },
  { id: "good-morning", label: "Good morning", emoji: "🌄", motion: "float" },
  { id: "on-fire", label: "On fire", emoji: "🔥", motion: "wobble" },
];

const BY_ID = new Map(STICKERS.map((sticker) => [sticker.id, sticker]));

export function stickerInfo(id: string): StickerInfo | undefined {
  return BY_ID.get(id);
}

export function isStickerId(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value);
}

/** What a sticker message says in text: "🌮 Hangry". */
export function stickerText(id: string) {
  const info = BY_ID.get(id);
  return info ? `${info.emoji} ${info.label}` : "Sticker";
}
