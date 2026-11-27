export const DEFAULT_MARKER_ICON = "dot";
export const DEFAULT_MARKER_COLOR = "#3d8fd4";

export const MARKER_COLORS = [
  { id: "#3d8fd4", label: "Blue" },
  { id: "#e23d2b", label: "Red" },
  { id: "#e2b15a", label: "Gold" },
  { id: "#9ed68a", label: "Green" },
  { id: "#f3f0e6", label: "Cream" },
  { id: "#e58ab0", label: "Pink" },
  { id: "#e07a3d", label: "Orange" },
  { id: "#8b7ad6", label: "Purple" },
  { id: "#3dbebf", label: "Teal" },
] as const;

/** The characters, in the order the picker shows them. Each wears your color. */
export const MARKER_ICONS = [
  { id: "dot", label: "Blob" },
  { id: "heart", label: "Heart" },
  { id: "car", label: "Road tripper" },
  { id: "rv", label: "Camper" },
  { id: "bigfoot", label: "Bigfoot" },
  { id: "alien", label: "Alien" },
  { id: "ufo", label: "UFO" },
  { id: "ghost", label: "Ghost" },
  { id: "cat", label: "Derpy cat" },
  { id: "raccoon", label: "Raccoon" },
  { id: "frog", label: "Frog" },
  { id: "duck", label: "Cowboy duck" },
  { id: "jackalope", label: "Jackalope" },
  { id: "moose", label: "Moose" },
  { id: "gator", label: "Cool gator" },
  { id: "flamingo", label: "Flamingo" },
  { id: "cactus", label: "Cactus" },
  { id: "sun", label: "Sunny" },
  { id: "moon", label: "Sleepy moon" },
  { id: "cloud", label: "Grumpy cloud" },
  { id: "mushroom", label: "Mushroom" },
  { id: "taco", label: "Taco" },
  { id: "hotdog", label: "Hot dog" },
  { id: "donut", label: "Donut" },
  { id: "pizza", label: "Pizza" },
  { id: "pickle", label: "Pickle" },
  { id: "corn", label: "Corn" },
  { id: "potato", label: "Potato" },
  { id: "marshmallow", label: "Marshmallow" },
  { id: "mug", label: "Coffee" },
  { id: "cone", label: "Traffic cone" },
] as const;

/** Markers people picked before the characters: each becomes the closest one. */
const LEGACY: Record<string, string> = {
  pin: "dot",
  star: "sun",
  paw: "raccoon",
  tent: "marshmallow",
  compass: "car",
  plane: "ufo",
  pack: "rv",
  camera: "alien",
  leaf: "frog",
  peak: "bigfoot",
  fish: "gator",
  bird: "flamingo",
  boot: "bigfoot",
  flag: "cone",
  bolt: "sun",
  anchor: "duck",
  bike: "car",
  flame: "marshmallow",
  bloom: "cactus",
  balloon: "ghost",
  ship: "duck",
  gem: "donut",
  key: "raccoon",
  tree: "moose",
  wave: "duck",
};

const ICON_IDS = new Set<string>(MARKER_ICONS.map((icon) => icon.id));
const COLOR_IDS = new Set<string>(MARKER_COLORS.map((color) => color.id));

/** The character a saved marker shows as now (older picks included). */
export function markerId(value: string) {
  return ICON_IDS.has(value) ? value : LEGACY[value] ?? DEFAULT_MARKER_ICON;
}

export function isMarkerIcon(value: unknown): value is string {
  return typeof value === "string" && (ICON_IDS.has(value) || value in LEGACY);
}

export function isMarkerColor(value: unknown): value is string {
  return typeof value === "string" && COLOR_IDS.has(value.toLowerCase());
}

export function markerLabel(icon: string) {
  const id = markerId(icon);
  return MARKER_ICONS.find((item) => item.id === id)?.label ?? "Blob";
}

type Pen = CanvasRenderingContext2D;
const INK = "#1c1915";
const WHITE = "#fbf8f0";
const PINK = "#ef7f97";
const TAU = Math.PI * 2;

/** The color, lighter (amount > 0) or darker (amount < 0). */
function tone(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255), gg = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)}`;
}

/** Fill with a color and outline in ink. */
function blob(g: Pen, fill: string, path: () => void) {
  g.beginPath();
  path();
  g.fillStyle = fill;
  g.fill();
  g.stroke();
}

function dot(g: Pen, x: number, y: number, r: number, fill = INK) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = fill;
  g.fill();
}

/** A googly eye: white, outlined, with the pupil looking (dx, dy). */
function eye(g: Pen, x: number, y: number, r: number, dx = 0, dy = 0) {
  blob(g, WHITE, () => g.arc(x, y, r, 0, TAU));
  const p = r * 0.52;
  dot(g, x + dx * (r - p - 0.6), y + dy * (r - p - 0.6), p);
  dot(g, x + dx * (r - p - 0.6) - p * 0.35, y + dy * (r - p - 0.6) - p * 0.4, p * 0.32, WHITE);
}

/** A sleepy (closed) eye: a downward arc. */
function shut(g: Pen, x: number, y: number, w: number) {
  g.beginPath();
  g.arc(x, y - w * 0.3, w, Math.PI * 0.2, Math.PI * 0.8);
  g.stroke();
}

function smile(g: Pen, x: number, y: number, w: number) {
  g.beginPath();
  g.arc(x, y - w * 0.55, w, Math.PI * 0.25, Math.PI * 0.75);
  g.stroke();
}

/** An open grin, with or without the tongue showing. */
function grin(g: Pen, x: number, y: number, w: number, tongue = true) {
  g.beginPath();
  g.moveTo(x - w, y);
  g.quadraticCurveTo(x, y + w * 1.5, x + w, y);
  g.closePath();
  g.fillStyle = INK;
  g.fill();
  g.stroke();
  if (tongue) {
    g.save();
    g.beginPath();
    g.moveTo(x - w, y);
    g.quadraticCurveTo(x, y + w * 1.5, x + w, y);
    g.closePath();
    g.clip();
    dot(g, x + w * 0.15, y + w * 0.95, w * 0.55, PINK);
    g.restore();
  }
}

/** A tongue sticking out, a bit to one side. */
function blep(g: Pen, x: number, y: number, w: number) {
  g.beginPath();
  g.moveTo(x - w, y);
  g.lineTo(x - w, y + w * 0.9);
  g.arc(x, y + w * 0.9, w, Math.PI, 0, true);
  g.lineTo(x + w, y);
  g.fillStyle = PINK;
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(x, y + 0.5);
  g.lineTo(x, y + w * 1.1);
  g.lineWidth = 1.6;
  g.stroke();
  g.lineWidth = 3;
}

function blush(g: Pen, x: number, y: number) {
  g.save();
  g.globalAlpha = 0.55;
  g.beginPath();
  g.ellipse(x, y, 3.6, 2.2, 0, 0, TAU);
  g.fillStyle = PINK;
  g.fill();
  g.restore();
}

/** Sunglasses centred on (x, y). */
function shades(g: Pen, x: number, y: number, w = 7) {
  blob(g, INK, () => {
    g.roundRect(x - w * 2 - 1, y - w * 0.55, w * 2, w * 1.25, [2, 2, w * 0.7, w * 0.7]);
    g.roundRect(x + 1, y - w * 0.55, w * 2, w * 1.25, [2, 2, w * 0.7, w * 0.7]);
  });
  g.beginPath();
  g.moveTo(x - 1.5, y - w * 0.3);
  g.lineTo(x + 1.5, y - w * 0.3);
  g.stroke();
  g.save();
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(x - w * 1.6, y - w * 0.15);
  g.lineTo(x - w * 1.2, y - w * 0.4);
  g.moveTo(x + w * 0.6, y - w * 0.15);
  g.lineTo(x + w, y - w * 0.4);
  g.stroke();
  g.restore();
}

/** A soft shine on a body. */
function shine(g: Pen, x: number, y: number, rx: number, ry: number, angle = -0.6) {
  g.save();
  g.globalAlpha = 0.45;
  g.beginPath();
  g.ellipse(x, y, rx, ry, angle, 0, TAU);
  g.fillStyle = WHITE;
  g.fill();
  g.restore();
}

function drawIcon(g: Pen, icon: string, color: string) {
  const dark = tone(color, -0.28);
  const light = tone(color, 0.35);
  switch (icon) {
    case "heart": {
      // The original heart, as it was.
      blob(g, color, () => {
        g.moveTo(32, 50);
        g.bezierCurveTo(6, 34, 10, 14, 22, 16);
        g.bezierCurveTo(28, 17, 31, 22, 32, 26);
        g.bezierCurveTo(33, 22, 36, 17, 42, 16);
        g.bezierCurveTo(54, 14, 58, 34, 32, 50);
        g.closePath();
      });
      return;
    }
    case "car": {
      // A little car with headlight eyes and too much luggage.
      blob(g, "#b9733f", () => g.roundRect(20, 9, 20, 9, 2));
      blob(g, "#e2b15a", () => g.roundRect(23, 4, 13, 7, 2));
      g.beginPath();
      g.moveTo(17, 18);
      g.lineTo(43, 18);
      g.stroke();
      blob(g, color, () => {
        g.moveTo(14, 30);
        g.lineTo(20, 18);
        g.lineTo(44, 18);
        g.lineTo(50, 30);
        g.closePath();
      });
      blob(g, "#bfe0ef", () => {
        g.moveTo(21, 29);
        g.lineTo(24, 22);
        g.lineTo(40, 22);
        g.lineTo(43, 29);
        g.closePath();
      });
      blob(g, color, () => g.roundRect(6, 28, 52, 16, 7));
      dot(g, 18, 50, 6.5);
      dot(g, 46, 50, 6.5);
      dot(g, 18, 50, 2.6, "#8a857a");
      dot(g, 46, 50, 2.6, "#8a857a");
      eye(g, 15, 35, 5.5, 0.4, 0.2);
      eye(g, 49, 35, 4.2, -0.3, 0.3);
      grin(g, 32, 37, 7);
      return;
    }
    case "rv": {
      // A camper van, beaming, with a bike on the back.
      blob(g, color, () => g.roundRect(6, 14, 50, 32, 9));
      blob(g, WHITE, () => g.roundRect(6, 14, 50, 9, [9, 9, 0, 0]));
      blob(g, light, () => g.rect(6, 30, 50, 4));
      blob(g, "#bfe0ef", () => g.roundRect(40, 24, 12, 8, 2));
      eye(g, 17, 32, 5.5, 0.5, 0);
      eye(g, 30, 32, 5.5, 0.5, 0);
      smile(g, 25, 41, 6);
      dot(g, 18, 48, 6);
      dot(g, 44, 48, 6);
      dot(g, 18, 48, 2.4, "#8a857a");
      dot(g, 44, 48, 2.4, "#8a857a");
      blob(g, "#e2b15a", () => g.roundRect(14, 8, 18, 6, 2));
      return;
    }
    case "bigfoot": {
      // Sasquatch, mid-stroll, very proud of his feet.
      blob(g, dark, () => g.ellipse(19, 56, 12, 5.5, -0.1, 0, TAU));
      blob(g, dark, () => g.ellipse(45, 56, 12, 5.5, 0.1, 0, TAU));
      blob(g, color, () => {
        g.moveTo(14, 54);
        g.bezierCurveTo(6, 34, 12, 6, 32, 5);
        g.bezierCurveTo(52, 6, 58, 34, 50, 54);
        g.quadraticCurveTo(46, 50, 42, 54);
        g.quadraticCurveTo(38, 49, 32, 53);
        g.quadraticCurveTo(26, 49, 22, 54);
        g.quadraticCurveTo(18, 50, 14, 54);
        g.closePath();
      });
      g.beginPath();
      g.moveTo(30, 5);
      g.lineTo(27, 0);
      g.moveTo(34, 5);
      g.lineTo(37, 1);
      g.stroke();
      blob(g, light, () => g.ellipse(32, 25, 14, 12, 0, 0, TAU));
      g.lineWidth = 3.6;
      g.beginPath();
      g.moveTo(20, 15);
      g.lineTo(29, 18);
      g.moveTo(44, 15);
      g.lineTo(35, 18);
      g.stroke();
      g.lineWidth = 3;
      eye(g, 26, 24, 4.4, 0.5, 0.2);
      eye(g, 38, 24, 4.4, -0.5, 0.2);
      grin(g, 32, 31, 6, false);
      blob(g, WHITE, () => {
        g.rect(28.5, 31, 3.5, 3);
        g.rect(32, 31, 3.5, 3);
      });
      return;
    }
    case "alien": {
      // A wide-eyed visitor with wobbly antennae.
      g.beginPath();
      g.moveTo(25, 13);
      g.quadraticCurveTo(22, 6, 16, 6);
      g.moveTo(39, 13);
      g.quadraticCurveTo(42, 6, 48, 6);
      g.stroke();
      blob(g, "#e2b15a", () => g.arc(15, 6, 4.2, 0, TAU));
      blob(g, "#e2b15a", () => g.arc(49, 6, 4.2, 0, TAU));
      blob(g, color, () => {
        g.moveTo(32, 58);
        g.bezierCurveTo(16, 58, 6, 40, 8, 28);
        g.bezierCurveTo(10, 14, 22, 12, 32, 12);
        g.bezierCurveTo(42, 12, 54, 14, 56, 28);
        g.bezierCurveTo(58, 40, 48, 58, 32, 58);
        g.closePath();
      });
      shine(g, 20, 21, 5, 3);
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(32 + side * 11, 34, 8, 11, side * 0.5, 0, TAU);
        g.fillStyle = INK;
        g.fill();
        dot(g, 32 + side * 11 - 2, 30, 2.8, WHITE);
        dot(g, 32 + side * 11 + 2, 38, 1.3, WHITE);
      }
      grin(g, 32, 48, 4, false);
      return;
    }
    case "ufo": {
      // A flying saucer with a tiny driver waving.
      const beam = g.createLinearGradient(0, 38, 0, 62);
      beam.addColorStop(0, "rgba(242,226,122,0.55)");
      beam.addColorStop(1, "rgba(242,226,122,0)");
      g.beginPath();
      g.moveTo(25, 38);
      g.lineTo(16, 62);
      g.lineTo(48, 62);
      g.lineTo(39, 38);
      g.closePath();
      g.fillStyle = beam;
      g.fill();
      blob(g, "#bfe0ef", () => g.arc(32, 26, 13, Math.PI, 0));
      blob(g, "#9ed68a", () => g.arc(32, 26, 6.5, Math.PI, 0));
      dot(g, 29.5, 22.5, 1.6);
      dot(g, 34.5, 22.5, 1.6);
      g.beginPath();
      g.moveTo(39, 22);
      g.lineTo(43, 16);
      g.stroke();
      shine(g, 25, 19, 3, 1.6);
      blob(g, color, () => g.ellipse(32, 32, 27, 9, 0, 0, TAU));
      blob(g, dark, () => g.ellipse(32, 37, 16, 4.5, 0, 0, Math.PI));
      for (const x of [14, 23, 32, 41, 50]) dot(g, x, 31, 2.4, "#f2e27a");
      return;
    }
    case "ghost": {
      // Boo, with a blep.
      blob(g, color, () => {
        g.moveTo(10, 56);
        g.lineTo(10, 28);
        g.bezierCurveTo(10, 4, 54, 4, 54, 28);
        g.lineTo(54, 56);
        g.quadraticCurveTo(50, 50, 46, 56);
        g.quadraticCurveTo(42, 50, 38, 56);
        g.quadraticCurveTo(34, 50, 30, 56);
        g.quadraticCurveTo(26, 50, 22, 56);
        g.quadraticCurveTo(18, 50, 14, 56);
        g.quadraticCurveTo(12, 53, 10, 56);
        g.closePath();
      });
      shine(g, 20, 16, 5, 3);
      eye(g, 24, 26, 6, 0.3, -0.4);
      eye(g, 40, 27, 4.5, -0.4, 0.4);
      g.beginPath();
      g.moveTo(25, 37);
      g.quadraticCurveTo(32, 42, 39, 37);
      g.stroke();
      blep(g, 34, 38.5, 3.5);
      blush(g, 17, 34);
      blush(g, 47, 34);
      return;
    }
    case "cat": {
      // A cat that is not thinking about anything at all.
      blob(g, color, () => {
        g.moveTo(10, 28);
        g.lineTo(12, 6);
        g.lineTo(25, 17);
        g.quadraticCurveTo(32, 15, 39, 17);
        g.lineTo(52, 6);
        g.lineTo(54, 28);
        g.bezierCurveTo(58, 46, 46, 56, 32, 56);
        g.bezierCurveTo(18, 56, 6, 46, 10, 28);
        g.closePath();
      });
      blob(g, PINK, () => {
        g.moveTo(15, 18);
        g.lineTo(15, 11);
        g.lineTo(21, 17);
        g.closePath();
        g.moveTo(49, 18);
        g.lineTo(49, 11);
        g.lineTo(43, 17);
        g.closePath();
      });
      eye(g, 22, 31, 6.5, 0.6, -0.2);
      eye(g, 42, 33, 4.5, -0.7, 0.4);
      blob(g, PINK, () => {
        g.moveTo(29, 38);
        g.lineTo(35, 38);
        g.lineTo(32, 41);
        g.closePath();
      });
      g.beginPath();
      g.moveTo(32, 41);
      g.quadraticCurveTo(28, 46, 25, 43);
      g.moveTo(32, 41);
      g.quadraticCurveTo(36, 46, 39, 43);
      g.stroke();
      blep(g, 33, 44, 2.8);
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(5, 37);
      g.lineTo(17, 39);
      g.moveTo(5, 43);
      g.lineTo(17, 42);
      g.moveTo(59, 37);
      g.lineTo(47, 39);
      g.moveTo(59, 43);
      g.lineTo(47, 42);
      g.stroke();
      g.lineWidth = 3;
      return;
    }
    case "raccoon": {
      // Trash panda, caught red-handed.
      blob(g, dark, () => {
        g.moveTo(11, 26);
        g.lineTo(9, 8);
        g.lineTo(24, 15);
        g.closePath();
        g.moveTo(53, 26);
        g.lineTo(55, 8);
        g.lineTo(40, 15);
        g.closePath();
      });
      blob(g, color, () => {
        g.moveTo(32, 14);
        g.bezierCurveTo(52, 14, 60, 30, 54, 42);
        g.bezierCurveTo(48, 54, 40, 56, 32, 56);
        g.bezierCurveTo(24, 56, 16, 54, 10, 42);
        g.bezierCurveTo(4, 30, 12, 14, 32, 14);
        g.closePath();
      });
      blob(g, WHITE, () => g.ellipse(32, 45, 12, 9, 0, 0, TAU));
      blob(g, INK, () => {
        g.moveTo(8, 30);
        g.quadraticCurveTo(20, 22, 32, 30);
        g.quadraticCurveTo(44, 22, 56, 30);
        g.quadraticCurveTo(50, 40, 40, 38);
        g.quadraticCurveTo(32, 36, 24, 38);
        g.quadraticCurveTo(14, 40, 8, 30);
        g.closePath();
      });
      eye(g, 21, 31, 4.6, 0.6, 0);
      eye(g, 43, 31, 4.6, 0.6, 0);
      dot(g, 32, 42, 3.2);
      g.beginPath();
      g.moveTo(32, 45);
      g.lineTo(32, 48);
      g.moveTo(27, 49);
      g.quadraticCurveTo(32, 52, 37, 49);
      g.stroke();
      blob(g, WHITE, () => g.rect(30.5, 49.5, 3, 3));
      return;
    }
    case "frog": {
      // A frog in a tiny top hat.
      blob(g, color, () => {
        g.moveTo(8, 40);
        g.bezierCurveTo(6, 24, 16, 20, 32, 22);
        g.bezierCurveTo(48, 20, 58, 24, 56, 40);
        g.bezierCurveTo(54, 54, 42, 56, 32, 56);
        g.bezierCurveTo(22, 56, 10, 54, 8, 40);
        g.closePath();
      });
      blob(g, color, () => g.arc(19, 22, 9, 0, TAU));
      blob(g, color, () => g.arc(45, 22, 9, 0, TAU));
      eye(g, 19, 22, 6, 0.3, 0.3);
      eye(g, 45, 22, 6, -0.3, 0.3);
      blob(g, light, () => g.ellipse(32, 47, 12, 6, 0, 0, TAU));
      g.beginPath();
      g.moveTo(14, 36);
      g.quadraticCurveTo(32, 48, 50, 36);
      g.stroke();
      blush(g, 13, 41);
      blush(g, 51, 41);
      blob(g, INK, () => g.roundRect(25, 4, 14, 12, 1));
      blob(g, INK, () => g.ellipse(32, 16, 11, 2.6, 0, 0, TAU));
      blob(g, "#e23d2b", () => g.rect(25, 11, 14, 3));
      return;
    }
    case "duck": {
      // A rubber duck who has seen some rodeos.
      blob(g, color, () => {
        g.moveTo(8, 42);
        g.bezierCurveTo(8, 32, 16, 32, 24, 36);
        g.bezierCurveTo(20, 30, 20, 16, 34, 15);
        g.bezierCurveTo(48, 14, 50, 30, 44, 36);
        g.bezierCurveTo(58, 32, 60, 42, 54, 50);
        g.bezierCurveTo(46, 58, 18, 58, 10, 50);
        g.closePath();
      });
      shine(g, 30, 22, 4, 2.4);
      blob(g, "#e07a3d", () => {
        g.moveTo(44, 26);
        g.quadraticCurveTo(58, 24, 58, 30);
        g.quadraticCurveTo(54, 35, 44, 32);
        g.closePath();
      });
      eye(g, 38, 24, 4.8, 0.6, 0);
      blush(g, 33, 31);
      g.beginPath();
      g.moveTo(16, 44);
      g.quadraticCurveTo(26, 50, 34, 42);
      g.stroke();
      blob(g, "#b9733f", () => {
        g.moveTo(16, 17);
        g.quadraticCurveTo(34, 21, 52, 15);
        g.quadraticCurveTo(48, 22, 34, 22);
        g.quadraticCurveTo(20, 22, 16, 17);
        g.closePath();
      });
      blob(g, "#b9733f", () => {
        g.moveTo(24, 18);
        g.quadraticCurveTo(24, 4, 30, 6);
        g.quadraticCurveTo(34, 9, 38, 6);
        g.quadraticCurveTo(44, 4, 44, 18);
        g.closePath();
      });
      blob(g, "#7a4a26", () => g.rect(24.5, 14, 19, 3));
      return;
    }
    case "jackalope": {
      // A bunny with antlers. Allegedly real.
      g.lineWidth = 3.4;
      g.strokeStyle = "#7a4a26";
      g.beginPath();
      g.moveTo(24, 16);
      g.lineTo(18, 4);
      g.moveTo(21, 10);
      g.lineTo(13, 8);
      g.moveTo(40, 16);
      g.lineTo(46, 4);
      g.moveTo(43, 10);
      g.lineTo(51, 8);
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      blob(g, color, () => {
        g.ellipse(14, 22, 5, 11, -0.9, 0, TAU);
      });
      blob(g, color, () => {
        g.ellipse(50, 22, 5, 11, 0.9, 0, TAU);
      });
      blob(g, PINK, () => g.ellipse(14, 22, 2, 7, -0.9, 0, TAU));
      blob(g, PINK, () => g.ellipse(50, 22, 2, 7, 0.9, 0, TAU));
      blob(g, color, () => g.ellipse(32, 38, 19, 17, 0, 0, TAU));
      blob(g, light, () => g.ellipse(32, 46, 9, 6, 0, 0, TAU));
      eye(g, 24, 34, 5, 0.3, 0.2);
      eye(g, 40, 34, 5, 0.3, 0.2);
      dot(g, 32, 42, 2.4, PINK);
      blob(g, WHITE, () => g.roundRect(29, 45, 6, 6, 1));
      g.beginPath();
      g.moveTo(32, 45);
      g.lineTo(32, 51);
      g.stroke();
      blush(g, 18, 42);
      blush(g, 46, 42);
      return;
    }
    case "moose": {
      // Big nose, bigger antlers, no thoughts.
      blob(g, "#e2b15a", () => {
        g.moveTo(20, 16);
        g.bezierCurveTo(10, 18, 2, 12, 4, 4);
        g.lineTo(8, 9);
        g.lineTo(10, 3);
        g.lineTo(14, 9);
        g.lineTo(18, 4);
        g.lineTo(20, 10);
        g.closePath();
        g.moveTo(44, 16);
        g.bezierCurveTo(54, 18, 62, 12, 60, 4);
        g.lineTo(56, 9);
        g.lineTo(54, 3);
        g.lineTo(50, 9);
        g.lineTo(46, 4);
        g.lineTo(44, 10);
        g.closePath();
      });
      blob(g, color, () => g.ellipse(32, 26, 14, 13, 0, 0, TAU));
      blob(g, dark, () => {
        g.moveTo(18, 34);
        g.bezierCurveTo(16, 56, 48, 56, 46, 34);
        g.closePath();
      });
      dot(g, 26, 46, 2.6);
      dot(g, 38, 46, 2.6);
      g.beginPath();
      g.moveTo(25, 51);
      g.quadraticCurveTo(32, 54, 39, 51);
      g.stroke();
      eye(g, 25, 24, 4.6, -0.3, 0.5);
      eye(g, 39, 24, 4.6, 0.4, 0.5);
      return;
    }
    case "gator": {
      // Too cool for the swamp.
      blob(g, color, () => {
        g.moveTo(6, 40);
        g.bezierCurveTo(6, 30, 14, 26, 24, 26);
        g.lineTo(54, 30);
        g.quadraticCurveTo(60, 32, 58, 38);
        g.lineTo(26, 46);
        g.quadraticCurveTo(10, 50, 6, 40);
        g.closePath();
      });
      blob(g, dark, () => {
        g.moveTo(14, 44);
        g.lineTo(56, 40);
        g.quadraticCurveTo(58, 48, 50, 50);
        g.lineTo(20, 52);
        g.quadraticCurveTo(12, 50, 14, 44);
        g.closePath();
      });
      blob(g, WHITE, () => {
        for (let x = 24; x <= 48; x += 6) {
          g.moveTo(x, 43.5);
          g.lineTo(x + 2, 47);
          g.lineTo(x + 4, 42.8);
        }
      });
      blob(g, color, () => g.arc(20, 22, 7, 0, TAU));
      blob(g, color, () => g.arc(33, 22, 7, 0, TAU));
      shades(g, 26.5, 22, 6.5);
      dot(g, 53, 33, 1.6);
      return;
    }
    case "flamingo": {
      // A lawn flamingo on one leg, slightly judging you.
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(36, 44);
      g.lineTo(36, 60);
      g.moveTo(36, 50);
      g.lineTo(30, 46);
      g.stroke();
      blob(g, color, () => g.ellipse(36, 38, 15, 9, -0.2, 0, TAU));
      blob(g, dark, () => {
        g.moveTo(30, 34);
        g.quadraticCurveTo(42, 32, 50, 40);
        g.quadraticCurveTo(40, 42, 30, 34);
        g.closePath();
      });
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(24, 34);
      g.bezierCurveTo(14, 26, 30, 18, 22, 10);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 3.6;
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      blob(g, color, () => g.arc(20, 10, 6.5, 0, TAU));
      blob(g, WHITE, () => {
        g.moveTo(10, 8);
        g.quadraticCurveTo(4, 12, 6, 18);
        g.lineTo(13, 13);
        g.closePath();
      });
      dot(g, 6.5, 16.5, 1.8);
      eye(g, 21, 9, 3.6, -0.6, -0.2);
      g.beginPath();
      g.moveTo(17, 4.5);
      g.lineTo(24, 5.5);
      g.stroke();
      return;
    }
    case "cactus": {
      // A saguaro in shades, waving both arms.
      blob(g, "#b9733f", () => {
        g.moveTo(16, 50);
        g.lineTo(48, 50);
        g.lineTo(44, 62);
        g.lineTo(20, 62);
        g.closePath();
      });
      blob(g, color, () => {
        g.moveTo(14, 34);
        g.lineTo(14, 20);
        g.arc(9.5, 20, 4.5, 0, Math.PI, true);
        g.lineTo(5, 34);
        g.quadraticCurveTo(5, 42, 14, 42);
        g.lineTo(22, 42);
        g.lineTo(22, 34);
        g.closePath();
      });
      blob(g, color, () => {
        g.moveTo(50, 30);
        g.lineTo(50, 14);
        g.arc(54.5, 14, 4.5, Math.PI, 0);
        g.lineTo(59, 30);
        g.quadraticCurveTo(59, 38, 50, 38);
        g.lineTo(42, 38);
        g.lineTo(42, 30);
        g.closePath();
      });
      blob(g, color, () => g.roundRect(20, 8, 24, 44, 12));
      blob(g, "#e58ab0", () => {
        for (let i = 0; i < 5; i += 1) {
          const a = -Math.PI / 2 + (i * TAU) / 5;
          g.moveTo(32, 6);
          g.ellipse(32 + Math.cos(a) * 3.5, 6 + Math.sin(a) * 3.5, 3, 2, a, 0, TAU);
        }
      });
      dot(g, 32, 6, 1.8, "#e2b15a");
      shades(g, 32, 22, 5.5);
      grin(g, 32, 30, 5.5);
      g.lineWidth = 1.6;
      g.beginPath();
      for (const [x, y] of [[24, 38], [40, 42], [26, 46], [9, 28], [55, 22]] as const) {
        g.moveTo(x - 1.5, y - 1.5);
        g.lineTo(x + 1.5, y + 1.5);
      }
      g.stroke();
      g.lineWidth = 3;
      return;
    }
    case "sun": {
      // Sunny, in shades, having the best day.
      blob(g, "#e2b15a", () => {
        for (let i = 0; i < 12; i += 1) {
          const a = (i * TAU) / 12;
          g.moveTo(32 + Math.cos(a - 0.17) * 19, 32 + Math.sin(a - 0.17) * 19);
          g.lineTo(32 + Math.cos(a) * 29, 32 + Math.sin(a) * 29);
          g.lineTo(32 + Math.cos(a + 0.17) * 19, 32 + Math.sin(a + 0.17) * 19);
          g.closePath();
        }
      });
      blob(g, color, () => g.arc(32, 32, 19, 0, TAU));
      shine(g, 24, 22, 4.5, 2.6);
      shades(g, 32, 29, 7);
      grin(g, 32, 37, 8);
      blush(g, 18, 37);
      blush(g, 46, 37);
      return;
    }
    case "moon": {
      // A crescent moon in a nightcap, mostly asleep.
      blob(g, color, () => {
        g.arc(30, 34, 22, Math.PI * 0.35, Math.PI * 1.65);
        g.bezierCurveTo(32, 18, 30, 50, 42, 54);
        g.closePath();
      });
      blob(g, "#8b7ad6", () => {
        g.moveTo(14, 18);
        g.quadraticCurveTo(26, 4, 42, 10);
        g.quadraticCurveTo(54, 12, 56, 28);
        g.quadraticCurveTo(44, 16, 30, 20);
        g.closePath();
      });
      blob(g, WHITE, () => g.arc(56, 29, 4, 0, TAU));
      blob(g, WHITE, () => g.roundRect(12, 16, 20, 5, 2.5));
      shut(g, 22, 34, 4);
      blush(g, 18, 41);
      g.beginPath();
      g.arc(26, 46, 3, 0, TAU);
      g.stroke();
      g.lineWidth = 2.2;
      g.font = "bold 9px sans-serif";
      g.fillStyle = INK;
      g.fillText("z", 44, 40);
      g.font = "bold 7px sans-serif";
      g.fillText("z", 50, 48);
      g.lineWidth = 3;
      return;
    }
    case "cloud": {
      // A rain cloud with a bad attitude.
      g.strokeStyle = "#3d8fd4";
      g.lineWidth = 3;
      g.beginPath();
      for (const [x, y] of [[18, 48], [30, 52], [42, 48], [24, 58], [38, 59]] as const) {
        g.moveTo(x, y);
        g.lineTo(x - 2, y + 4);
      }
      g.stroke();
      g.strokeStyle = INK;
      blob(g, color, () => {
        g.moveTo(12, 44);
        g.arc(14, 34, 9, Math.PI * 0.6, Math.PI * 1.5);
        g.arc(28, 24, 13, Math.PI * 1.1, Math.PI * 1.9);
        g.arc(44, 28, 11, Math.PI * 1.3, Math.PI * 0.1);
        g.arc(50, 38, 7, Math.PI * 1.6, Math.PI * 0.5);
        g.closePath();
      });
      shine(g, 24, 18, 4, 2.4);
      g.beginPath();
      g.moveTo(17, 27);
      g.lineTo(27, 31);
      g.moveTo(43, 27);
      g.lineTo(33, 31);
      g.stroke();
      eye(g, 23, 34, 3.6, 0.2, 0.3);
      eye(g, 37, 34, 3.6, -0.2, 0.3);
      g.beginPath();
      g.arc(30, 44, 5, Math.PI * 1.2, Math.PI * 1.8);
      g.stroke();
      return;
    }
    case "mushroom": {
      // A spotted toadstool with a goofy grin.
      blob(g, WHITE, () => {
        g.moveTo(22, 34);
        g.quadraticCurveTo(18, 56, 26, 58);
        g.lineTo(38, 58);
        g.quadraticCurveTo(46, 56, 42, 34);
        g.closePath();
      });
      eye(g, 27, 44, 3.8, 0.2, 0.2);
      eye(g, 37, 44, 3.8, 0.2, 0.2);
      grin(g, 32, 50, 4);
      blob(g, color, () => {
        g.moveTo(6, 34);
        g.bezierCurveTo(4, 12, 20, 6, 32, 6);
        g.bezierCurveTo(44, 6, 60, 12, 58, 34);
        g.quadraticCurveTo(32, 30, 6, 34);
        g.closePath();
      });
      for (const [x, y, r] of [[18, 20, 4.5], [33, 13, 3.6], [46, 22, 4], [27, 26, 2.6]] as const) {
        blob(g, WHITE, () => g.arc(x, y, r, 0, TAU));
      }
      return;
    }
    case "taco": {
      // A taco, extremely pleased with its fillings.
      blob(g, "#9ed68a", () => {
        g.moveTo(8, 34);
        g.quadraticCurveTo(12, 14, 20, 20);
        g.quadraticCurveTo(26, 8, 34, 16);
        g.quadraticCurveTo(42, 8, 46, 20);
        g.quadraticCurveTo(54, 14, 56, 34);
        g.closePath();
      });
      for (const [x, y] of [[18, 22], [31, 17], [44, 21]] as const) blob(g, "#e23d2b", () => g.arc(x, y, 3.6, 0, TAU));
      blob(g, "#f2e27a", () => g.rect(23, 19, 5, 4));
      blob(g, "#f2e27a", () => g.rect(37, 19, 5, 4));
      blob(g, color, () => {
        g.moveTo(4, 52);
        g.bezierCurveTo(4, 16, 60, 16, 60, 52);
        g.closePath();
      });
      shine(g, 18, 32, 4, 2.4);
      for (const [x, y] of [[14, 44], [50, 45], [44, 33]] as const) dot(g, x, y, 1.4, dark);
      eye(g, 24, 38, 5, 0.2, 0.3);
      eye(g, 40, 38, 5, -0.2, 0.3);
      grin(g, 32, 44, 5);
      return;
    }
    case "hotdog": {
      // A hot dog with a mustard mustache.
      blob(g, light, () => g.roundRect(4, 26, 56, 26, 13));
      blob(g, "#c8553d", () => g.roundRect(8, 18, 48, 18, 9));
      g.strokeStyle = "#f2c94c";
      g.lineWidth = 3.4;
      g.beginPath();
      g.moveTo(14, 24);
      for (let x = 14; x < 50; x += 6) g.quadraticCurveTo(x + 3, 19, x + 6, 24);
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      blob(g, color, () => g.roundRect(6, 34, 52, 20, 10));
      eye(g, 24, 42, 4.6, 0.3, -0.2);
      eye(g, 40, 42, 4.6, 0.3, -0.2);
      grin(g, 32, 47, 4.5);
      blush(g, 15, 47);
      blush(g, 49, 47);
      return;
    }
    case "donut": {
      // A frosted donut with sprinkles and a big smile.
      blob(g, "#d6a46c", () => {
        g.arc(32, 34, 24, 0, TAU);
        g.moveTo(39, 34);
        g.arc(32, 34, 7, 0, TAU, true);
      });
      blob(g, color, () => {
        g.moveTo(10, 32);
        g.bezierCurveTo(8, 10, 56, 10, 54, 32);
        g.quadraticCurveTo(52, 38, 48, 34);
        g.quadraticCurveTo(44, 42, 40, 36);
        g.lineTo(38, 34);
        g.arc(32, 32, 6, 0, Math.PI, true);
        g.quadraticCurveTo(22, 42, 18, 36);
        g.quadraticCurveTo(14, 40, 10, 32);
        g.closePath();
      });
      g.lineWidth = 2.4;
      const sprinkles = [[16, 22, "#e23d2b"], [22, 15, "#f3f0e6"], [42, 15, "#e2b15a"], [48, 23, "#9ed68a"], [33, 12, "#3dbebf"]] as const;
      for (const [x, y, c] of sprinkles) {
        g.strokeStyle = c;
        g.beginPath();
        g.moveTo(x - 1.6, y - 1);
        g.lineTo(x + 1.6, y + 1);
        g.stroke();
      }
      g.strokeStyle = INK;
      g.lineWidth = 3;
      eye(g, 22, 44, 4, 0.2, 0.2);
      eye(g, 42, 44, 4, -0.2, 0.2);
      smile(g, 32, 51, 5);
      return;
    }
    case "pizza": {
      // A slice, with pepperoni and a cheesy drip.
      blob(g, color, () => {
        g.moveTo(8, 14);
        g.quadraticCurveTo(32, 4, 56, 14);
        g.lineTo(34, 58);
        g.quadraticCurveTo(32, 62, 30, 58);
        g.closePath();
      });
      blob(g, "#d6a46c", () => {
        g.moveTo(6, 14);
        g.quadraticCurveTo(32, 2, 58, 14);
        g.lineTo(56, 19);
        g.quadraticCurveTo(32, 9, 8, 19);
        g.closePath();
      });
      blob(g, color, () => {
        g.moveTo(40, 30);
        g.quadraticCurveTo(44, 40, 42, 44);
        g.arc(40.5, 44, 1.5, 0, Math.PI);
        g.quadraticCurveTo(38, 38, 36, 32);
        g.closePath();
      });
      blob(g, "#c8553d", () => g.arc(20, 24, 4, 0, TAU));
      blob(g, "#c8553d", () => g.arc(31, 46, 3.4, 0, TAU));
      eye(g, 27, 27, 4.2, 0, 0.3);
      eye(g, 38, 25, 3.6, 0, 0.3);
      grin(g, 32, 34, 4.2);
      return;
    }
    case "pickle": {
      // A pickle, bumpy and baffled.
      blob(g, color, () => {
        g.moveTo(24, 6);
        g.bezierCurveTo(10, 8, 12, 30, 14, 44);
        g.bezierCurveTo(16, 60, 42, 62, 46, 48);
        g.bezierCurveTo(52, 30, 46, 8, 34, 6);
        g.closePath();
      });
      for (const [x, y] of [[20, 18], [42, 22], [18, 38], [44, 40], [30, 52]] as const) dot(g, x, y, 1.6, dark);
      shine(g, 22, 14, 3, 5, 0.2);
      eye(g, 25, 26, 5.5, -0.5, -0.4);
      eye(g, 37, 28, 3.6, 0.5, 0.6);
      g.beginPath();
      g.ellipse(31, 40, 3, 4, 0, 0, TAU);
      g.fillStyle = INK;
      g.fill();
      g.beginPath();
      g.moveTo(21, 19);
      g.lineTo(28, 17);
      g.moveTo(34, 21);
      g.lineTo(40, 23);
      g.stroke();
      return;
    }
    case "corn": {
      // An ear of corn, all smiles.
      blob(g, "#9ed68a", () => {
        g.moveTo(32, 60);
        g.quadraticCurveTo(10, 50, 10, 24);
        g.quadraticCurveTo(22, 40, 32, 46);
        g.quadraticCurveTo(42, 40, 54, 24);
        g.quadraticCurveTo(54, 50, 32, 60);
        g.closePath();
      });
      blob(g, color, () => g.ellipse(32, 28, 13, 24, 0, 0, TAU));
      g.save();
      g.beginPath();
      g.ellipse(32, 28, 13, 24, 0, 0, TAU);
      g.clip();
      g.lineWidth = 1.4;
      g.strokeStyle = dark;
      g.beginPath();
      for (let y = 8; y < 52; y += 6) {
        g.moveTo(18, y);
        g.lineTo(46, y);
      }
      for (let x = 22; x < 46; x += 6) {
        g.moveTo(x, 4);
        g.lineTo(x, 52);
      }
      g.stroke();
      g.restore();
      eye(g, 26, 24, 4.4, 0.3, 0.2);
      eye(g, 38, 24, 4.4, 0.3, 0.2);
      grin(g, 32, 32, 5);
      return;
    }
    case "potato": {
      // A couch potato with a bit of a mustache.
      blob(g, color, () => {
        g.moveTo(32, 8);
        g.bezierCurveTo(52, 6, 58, 24, 54, 38);
        g.bezierCurveTo(50, 56, 34, 58, 24, 56);
        g.bezierCurveTo(8, 54, 6, 38, 10, 26);
        g.bezierCurveTo(14, 12, 22, 8, 32, 8);
        g.closePath();
      });
      for (const [x, y] of [[16, 22], [48, 18], [46, 44], [20, 46]] as const) dot(g, x, y, 1.8, dark);
      eye(g, 25, 28, 5, 0, 0.2);
      eye(g, 39, 27, 5.5, 0, 0.2);
      blob(g, dark, () => {
        g.moveTo(32, 38);
        g.quadraticCurveTo(22, 34, 20, 42);
        g.quadraticCurveTo(26, 39, 32, 41);
        g.quadraticCurveTo(38, 39, 44, 42);
        g.quadraticCurveTo(42, 34, 32, 38);
        g.closePath();
      });
      smile(g, 32, 48, 4);
      return;
    }
    case "marshmallow": {
      // A toasty marshmallow on a stick, a little singed.
      g.strokeStyle = "#7a4a26";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(32, 46);
      g.lineTo(46, 62);
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      blob(g, color, () => g.roundRect(14, 12, 36, 36, 11));
      blob(g, "#b9733f", () => {
        g.moveTo(14, 23);
        g.lineTo(14, 22);
        g.quadraticCurveTo(14, 12, 25, 12);
        g.lineTo(39, 12);
        g.quadraticCurveTo(50, 12, 50, 22);
        g.lineTo(50, 23);
        g.quadraticCurveTo(44, 19, 38, 23);
        g.quadraticCurveTo(32, 18, 26, 23);
        g.quadraticCurveTo(20, 19, 14, 23);
        g.closePath();
      });
      eye(g, 25, 30, 4.4, 0.4, 0);
      eye(g, 39, 30, 4.4, 0.4, 0);
      grin(g, 32, 37, 5);
      blush(g, 19, 38);
      blush(g, 45, 38);
      g.strokeStyle = "#8a857a";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(24, 8);
      g.quadraticCurveTo(21, 4, 25, 1);
      g.moveTo(38, 8);
      g.quadraticCurveTo(35, 4, 39, 1);
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      return;
    }
    case "mug": {
      // A coffee cup that has not had its coffee yet.
      g.strokeStyle = "#8a857a";
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(22, 12);
      g.quadraticCurveTo(18, 7, 22, 2);
      g.moveTo(31, 12);
      g.quadraticCurveTo(27, 7, 31, 2);
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      blob(g, color, () => g.arc(48, 34, 9, -Math.PI / 2, Math.PI / 2));
      blob(g, light, () => g.arc(48, 34, 3.5, -Math.PI / 2, Math.PI / 2));
      blob(g, color, () => {
        g.moveTo(8, 16);
        g.lineTo(48, 16);
        g.lineTo(44, 52);
        g.quadraticCurveTo(43, 56, 39, 56);
        g.lineTo(17, 56);
        g.quadraticCurveTo(13, 56, 12, 52);
        g.closePath();
      });
      blob(g, "#7a4a26", () => g.ellipse(28, 17, 20, 3.2, 0, 0, TAU));
      shut(g, 21, 32, 4);
      shut(g, 35, 32, 4);
      g.beginPath();
      g.moveTo(17, 27);
      g.lineTo(24, 28);
      g.moveTo(39, 27);
      g.lineTo(32, 28);
      g.stroke();
      g.beginPath();
      g.ellipse(28, 44, 3.4, 2.4, 0, 0, TAU);
      g.fillStyle = INK;
      g.fill();
      return;
    }
    case "cone": {
      // A traffic cone, alarmed, as usual.
      blob(g, color, () => g.roundRect(6, 52, 52, 8, 2));
      blob(g, color, () => {
        g.moveTo(28, 6);
        g.lineTo(36, 6);
        g.lineTo(50, 53);
        g.lineTo(14, 53);
        g.closePath();
      });
      g.save();
      g.beginPath();
      g.moveTo(28, 6);
      g.lineTo(36, 6);
      g.lineTo(50, 53);
      g.lineTo(14, 53);
      g.closePath();
      g.clip();
      g.fillStyle = WHITE;
      g.fillRect(0, 16, 64, 6);
      g.fillRect(0, 42, 64, 5);
      g.restore();
      eye(g, 26, 31, 4.2, 0, -0.5);
      eye(g, 38, 31, 4.2, 0, -0.5);
      g.beginPath();
      g.ellipse(32, 39, 2.4, 2.8, 0, 0, TAU);
      g.fillStyle = INK;
      g.fill();
      return;
    }
    default: {
      // Blob: a happy jelly bean with its tongue out. The default.
      blob(g, color, () => {
        g.moveTo(32, 8);
        g.bezierCurveTo(50, 8, 56, 26, 55, 38);
        g.bezierCurveTo(54, 52, 44, 56, 32, 56);
        g.bezierCurveTo(20, 56, 10, 52, 9, 38);
        g.bezierCurveTo(8, 26, 14, 8, 32, 8);
        g.closePath();
      });
      shine(g, 22, 18, 5, 3);
      eye(g, 24, 28, 6.5, 0.4, -0.3);
      eye(g, 41, 30, 5, -0.5, 0.3);
      g.beginPath();
      g.moveTo(22, 40);
      g.quadraticCurveTo(32, 47, 42, 40);
      g.stroke();
      blep(g, 35, 42.5, 3.6);
      blush(g, 15, 38);
      blush(g, 49, 38);
    }
  }
}

/** Paint a location badge into a square canvas context, origin at the top left. */
export function paintYouMarker(g: Pen, icon: string, color: string, size: number) {
  g.clearRect(0, 0, size, size);
  g.save();
  g.scale(size / 64, size / 64);
  g.fillStyle = color;
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.lineJoin = "round";
  g.lineCap = "round";
  drawIcon(g, markerId(icon), isMarkerColor(color) ? color : DEFAULT_MARKER_COLOR);
  g.restore();
}

/** Pixels on the map for a marker (shown at half size, so 42 px on screen). */
export const MARKER_PIXELS = 84;

export function youMarkerImage(icon: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = MARKER_PIXELS;
  canvas.height = MARKER_PIXELS;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("No canvas");
  paintYouMarker(g, icon, color, MARKER_PIXELS);
  return g.getImageData(0, 0, MARKER_PIXELS, MARKER_PIXELS);
}
