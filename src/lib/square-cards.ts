/**
 * City squares modifier cards. Now and then a new square deals you a card,
 * and until you've done what it says you can't collect any more squares
 * (anything you pass through meanwhile doesn't count). Each card is checked
 * by the app itself:
 *
 *   cats:  go to a place of one of these kinds inside the game's area. When
 *          a game starts, the places of each kind inside it are listed (the
 *          deck); only cards with somewhere to go are dealt, the card shows
 *          the nearest. It's done when you stop there, open the card and tap
 *          "I'm here": the phone checks you're within 100 feet of one (a place
 *          you've been before counts; in one game each place does one card)
 *   photo: add a photo
 *   county: get a county (a new one)
 *   wait:  sit it out this many minutes
 *   wild:  nothing to do
 *   osm:   go to an everyday place of this kind (a library, a water tower…),
 *          from OpenStreetMap: the server looks up what's inside the area once
 *          when the game starts (the game's "spots"); checked like cats
 *   grid:  something the grid itself can check, so there's always a deck even
 *          in a town with almost nothing in the atlas: a corner square, the
 *          middle, the edge, the far side, back to the start, five new squares
 *          in a straight run, a hole in your squares, a new square after dark,
 *          or (in a race) a square a friend has. The phone spots it as you go
 *          and the server checks it (you have to be standing in the square).
 *
 * The colors are a deck's four (and black for wild ones).
 */
export type CardColor = "red" | "yellow" | "green" | "blue" | "wild";

/** What a grid card asks for (see above). */
export type GridRule = "corner" | "middle" | "edge" | "far" | "start" | "run" | "hole" | "dark" | "ink";

export type SquareCard = {
  id: string;
  name: string;
  /** What to do, as the card says it. */
  task: string;
  color: CardColor;
  icon: string;
  cats?: string[];
  photo?: boolean;
  county?: boolean;
  wait?: number;
  wild?: boolean;
  osm?: string;
  grid?: GridRule;
  /** Dropped from the deck in a Hard game once half the area is done. */
  easy?: boolean;
};

export const SQUARE_CARDS: SquareCard[] = [
  { id: "historic", name: "Historical marker", task: "Visit a historic site or marker.", color: "red", icon: "Landmark", cats: ["historic", "register", "landmark", "president", "capitol"] },
  { id: "hungry", name: "Hungry", task: "Eat somewhere local.", color: "yellow", icon: "UtensilsCrossed", cats: ["food", "diner", "market"] },
  { id: "grass", name: "Touch grass", task: "Visit a park or a garden.", color: "green", icon: "Trees", cats: ["park", "garden", "forest", "refuge"] },
  { id: "museum", name: "Museum day", task: "Visit a museum.", color: "blue", icon: "Library", cats: ["museum", "observatory", "space"] },
  { id: "cheers", name: "Cheers", task: "Stop at a brewery, winery or distillery.", color: "yellow", icon: "Beer", cats: ["brewery", "winery", "distillery"] },
  { id: "splash", name: "Make a splash", task: "Get to a lake, beach, waterfall or hot spring.", color: "blue", icon: "Waves", cats: ["lake", "beach", "waterfall", "hotspring", "seashore"] },
  { id: "bridge", name: "Bridge it", task: "Cross a famous bridge, tunnel, dam or ferry.", color: "blue", icon: "Spline", cats: ["bridge", "tunnel", "span", "dam", "ferry"] },
  { id: "weird", name: "Roadside weird", task: "Find a roadside attraction.", color: "red", icon: "Sparkles", cats: ["roadside", "drivein", "amusement"] },
  { id: "spooky", name: "Spooky", task: "Visit a cemetery or a ghost town.", color: "green", icon: "Ghost", cats: ["cemetery", "ghost"] },
  { id: "chain", name: "Drive-thru", task: "Stop at a chain restaurant.", color: "red", icon: "Store", cats: ["chain"], easy: true },
  { id: "rails", name: "All aboard", task: "Visit a railroad site.", color: "yellow", icon: "TrainFront", cats: ["railroad"] },
  { id: "battle", name: "History buff", task: "Visit a fort or a battlefield.", color: "red", icon: "Castle", cats: ["fort", "battlefield"] },
  { id: "photo", name: "Photo op", task: "Take a photo in the app.", color: "yellow", icon: "Camera", photo: true },
  { id: "five", name: "Take five", task: "Take a 10-minute break.", color: "blue", icon: "Coffee", wait: 10, easy: true },
  { id: "skip", name: "Skip", task: "Sit out for 20 minutes.", color: "red", icon: "Ban", wait: 20 },
  { id: "wild", name: "Wild", task: "Lucky you. Nothing to do.", color: "wild", icon: "Star", wild: true, easy: true },
  { id: "wild2", name: "Wild", task: "Free pass. Keep going.", color: "wild", icon: "Sparkles", wild: true, easy: true },
  // Everyday places (OpenStreetMap, looked up when the game starts).
  { id: "library", name: "Library", task: "Go to the public library.", color: "blue", icon: "BookOpen", osm: "library" },
  { id: "church", name: "Sunday best", task: "Stop at a church.", color: "yellow", icon: "Church", osm: "church" },
  { id: "school", name: "Drop off", task: "Go by a school.", color: "red", icon: "School", osm: "school" },
  { id: "hall", name: "City hall", task: "Go to the town hall or the courthouse.", color: "blue", icon: "Landmark", osm: "hall" },
  { id: "post", name: "Postage", task: "Stop at the post office.", color: "red", icon: "Mail", osm: "post" },
  { id: "grocery", name: "Groceries", task: "Go to a supermarket.", color: "green", icon: "ShoppingCart", osm: "grocery" },
  { id: "fuel", name: "Fill up", task: "Stop at a gas station.", color: "yellow", icon: "Fuel", osm: "fuel" },
  { id: "ball", name: "Play ball", task: "Get to a ball field or a playground.", color: "green", icon: "Volleyball", osm: "ball" },
  { id: "tower", name: "The tower", task: "Find a water tower.", color: "blue", icon: "Milestone", osm: "tower" },
  { id: "graves", name: "Local graves", task: "Visit a cemetery.", color: "green", icon: "Cross", osm: "graves" },
  { id: "creek", name: "Over the creek", task: "Stand on a bridge.", color: "blue", icon: "Spline", osm: "bridge" },
  { id: "tracks", name: "The tracks", task: "Get to a railroad crossing.", color: "yellow", icon: "TrainTrack", osm: "crossing" },
  // The grid checks these itself.
  { id: "corner", name: "Four corners", task: "Get to the corner square shown.", color: "red", icon: "Scan", grid: "corner" },
  { id: "middle", name: "Middle of town", task: "Get to the center square.", color: "yellow", icon: "Crosshair", grid: "middle" },
  { id: "edge", name: "The edge", task: "Get to any square on the outline.", color: "green", icon: "Frame", grid: "edge" },
  { id: "far", name: "Far side", task: "Get to the empty square farthest from you.", color: "blue", icon: "MoveUpRight", grid: "far" },
  { id: "start", name: "Back where you started", task: "Go back to your first square.", color: "yellow", icon: "Undo2", grid: "start" },
  { id: "run", name: "A straight run", task: "Five new squares in a row, touching, in a straight line.", color: "red", icon: "MoveRight", grid: "run" },
  { id: "hole", name: "Fill a hole", task: "Get to an empty square with yours on at least three sides.", color: "green", icon: "SquareDashed", grid: "hole" },
  { id: "dark", name: "After dark", task: "A new square, after sunset.", color: "blue", icon: "Moon", grid: "dark" },
  { id: "ink", name: "Their ink", task: "Stand in a square a friend already has.", color: "red", icon: "Footprints", grid: "ink" },
];

/** About one new square in this many deals a card. */
export const CARD_EVERY = 20;
/** Cards each player can swap for another in a game (one that can't be done nearby). */
export const CARD_SWAPS = 3;

export function cardById(id: string) {
  return SQUARE_CARDS.find((card) => card.id === id) ?? null;
}

/** How close you have to be to a card's place when you tap "I'm here": 100 feet, in miles. */
export const CARD_REACH_MILES = 100 / 5280;
/** Places listed per card in a game's deck (spread out if there are more). */
export const DECK_MAX = 300;

/** A game's deck: for each "go to" card (catalog or everyday places), its places inside the area, [id, name, lat, lon]. */
export type Deck = Record<string, [string, string, number, number][]>;

/** What decides which grid cards can be dealt right now. */
export type DealContext = {
  hard?: boolean;
  /** 0 to 1: how much of the area is done. */
  progress?: number;
  race?: boolean;
  /** Squares a friend has (race), empty squares with yours on three sides, your first square. */
  inkSquares?: number;
  holes?: number;
  hasStart?: boolean;
  /** Within a couple of hours of sunset, or after it (and before sunrise). */
  nearDark?: boolean;
  /** A swap in a Hard game: never a Wild. */
  swap?: boolean;
  /** No grid cards: a game only an older app has opened (it couldn't do them). */
  noGrid?: boolean;
};

/** The cards that can be dealt: "go to" ones only where the deck has somewhere to go, grid ones when they make sense. */
export function dealable(deck: Deck | null, ctx: DealContext = {}): SquareCard[] {
  return SQUARE_CARDS.filter((card) => {
    if (card.county) return false;
    if (card.cats && deck && (deck[card.id]?.length ?? 0) === 0) return false;
    // Everyday places only once the game's spots are in (an older game has none).
    if (card.osm && (deck?.[card.id]?.length ?? 0) === 0) return false;
    if (ctx.hard && card.easy && (ctx.progress ?? 0) >= 0.5) return false;
    if (ctx.hard && ctx.swap && card.wild) return false;
    if (card.grid && ctx.noGrid) return false;
    if (card.grid === "ink" && !(ctx.race && (ctx.inkSquares ?? 0) > 0)) return false;
    if (card.grid === "hole" && !(ctx.holes ?? 0)) return false;
    if (card.grid === "start" && !ctx.hasStart) return false;
    if (card.grid === "dark" && !ctx.nearDark) return false;
    return true;
  });
}

export function drawCard(not?: string | null, deck: Deck | null = null, ctx: DealContext = {}): SquareCard {
  const deck2 = dealable(deck, ctx);
  const pool = deck2.length > 1 ? deck2.filter((card) => card.id !== not) : deck2;
  return pool[Math.floor(Math.random() * pool.length)] ?? SQUARE_CARDS[0];
}

/** The everyday-place kinds looked up from OpenStreetMap, and what a place of each is called when it has no name. */
export const SPOT_KINDS: Record<string, string> = {
  library: "Library",
  church: "Church",
  school: "School",
  hall: "Town hall",
  post: "Post office",
  grocery: "Supermarket",
  fuel: "Gas station",
  ball: "Ball field",
  tower: "Water tower",
  graves: "Cemetery",
  bridge: "Bridge",
  crossing: "Railroad crossing",
};
