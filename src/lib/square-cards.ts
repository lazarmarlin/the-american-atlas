/**
 * City squares modifier cards. Now and then a new square deals you a card,
 * and until you've done what it says you can't collect any more squares
 * (anything you pass through meanwhile doesn't count). Each card is checked
 * by the app itself:
 *
 *   cats:  go to a place of one of these kinds (a new one or a visit again):
 *          the number of visits to such places goes up after it's dealt
 *   photo: add a photo
 *   county: get a county (a new one)
 *   wait:  sit it out this many minutes
 *   wild:  nothing to do
 *
 * The colors are a deck's four (and black for wild ones).
 */
export type CardColor = "red" | "yellow" | "green" | "blue" | "wild";

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
  { id: "chain", name: "Drive-thru", task: "Stop at a chain restaurant.", color: "red", icon: "Store", cats: ["chain"] },
  { id: "rails", name: "All aboard", task: "Visit a railroad site.", color: "yellow", icon: "TrainFront", cats: ["railroad"] },
  { id: "battle", name: "History buff", task: "Visit a fort or a battlefield.", color: "red", icon: "Castle", cats: ["fort", "battlefield"] },
  { id: "photo", name: "Photo op", task: "Take a photo in the app.", color: "yellow", icon: "Camera", photo: true },
  { id: "county", name: "New county", task: "Get a county you haven't had.", color: "green", icon: "MapPinned", county: true },
  { id: "five", name: "Take five", task: "Take a 10-minute break.", color: "blue", icon: "Coffee", wait: 10 },
  { id: "skip", name: "Skip", task: "Sit out for 20 minutes.", color: "red", icon: "Ban", wait: 20 },
  { id: "wild", name: "Wild", task: "Lucky you. Nothing to do.", color: "wild", icon: "Star", wild: true },
  { id: "wild2", name: "Wild", task: "Free pass. Keep going.", color: "wild", icon: "Sparkles", wild: true },
];

/** About one new square in this many deals a card. */
export const CARD_EVERY = 20;
/** Cards each player can swap for another in a game (one that can't be done nearby). */
export const CARD_SWAPS = 3;

export function cardById(id: string) {
  return SQUARE_CARDS.find((card) => card.id === id) ?? null;
}

export function drawCard(not?: string | null): SquareCard {
  const deck = SQUARE_CARDS.filter((card) => card.id !== not);
  return deck[Math.floor(Math.random() * deck.length)] ?? SQUARE_CARDS[0];
}
