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

export const MARKER_ICONS = [
  { id: "dot", label: "Dot" },
  { id: "pin", label: "Pin" },
  { id: "star", label: "Star" },
  { id: "heart", label: "Heart" },
  { id: "paw", label: "Paw" },
  { id: "mug", label: "Mug" },
  { id: "tent", label: "Tent" },
  { id: "car", label: "Car" },
  { id: "compass", label: "Compass" },
  { id: "plane", label: "Plane" },
  { id: "pack", label: "Pack" },
  { id: "camera", label: "Camera" },
  { id: "sun", label: "Sun" },
  { id: "moon", label: "Moon" },
  { id: "leaf", label: "Leaf" },
  { id: "peak", label: "Peak" },
  { id: "fish", label: "Fish" },
  { id: "bird", label: "Bird" },
  { id: "boot", label: "Boot" },
  { id: "flag", label: "Flag" },
  { id: "bolt", label: "Bolt" },
  { id: "anchor", label: "Anchor" },
  { id: "bike", label: "Bike" },
  { id: "flame", label: "Flame" },
  { id: "bloom", label: "Flower" },
  { id: "balloon", label: "Balloon" },
  { id: "ship", label: "Ship" },
  { id: "cat", label: "Cat" },
  { id: "gem", label: "Gem" },
  { id: "key", label: "Key" },
  { id: "mushroom", label: "Mushroom" },
  { id: "cloud", label: "Cloud" },
  { id: "tree", label: "Tree" },
  { id: "wave", label: "Wave" },
] as const;

const ICON_IDS = new Set<string>(MARKER_ICONS.map((icon) => icon.id));
const COLOR_IDS = new Set<string>(MARKER_COLORS.map((color) => color.id));

export function isMarkerIcon(value: unknown): value is string {
  return typeof value === "string" && ICON_IDS.has(value);
}

export function isMarkerColor(value: unknown): value is string {
  return typeof value === "string" && COLOR_IDS.has(value.toLowerCase());
}

export function markerLabel(icon: string) {
  return MARKER_ICONS.find((item) => item.id === icon)?.label ?? "Dot";
}

type Pen = CanvasRenderingContext2D;
const INK = "#1c1915";

function seal(g: Pen) {
  g.fill();
  g.stroke();
}

function inkDots(g: Pen, dots: [number, number, number][]) {
  const color = g.fillStyle;
  g.fillStyle = INK;
  for (const [x, y, r] of dots) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = color;
}

function drawIcon(g: Pen, icon: string) {
  const color = g.fillStyle;
  if (icon === "pin") {
    g.beginPath();
    g.arc(32, 24, 12, 0, Math.PI * 2);
    g.moveTo(21, 30);
    g.lineTo(32, 50);
    g.lineTo(43, 30);
    g.closePath();
    seal(g);
    inkDots(g, [[32, 24, 4]]);
    return;
  }
  if (icon === "star") {
    g.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? 20 : 8.5;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = 32 + Math.cos(angle) * radius;
      const y = 33 + Math.sin(angle) * radius;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "heart") {
    g.beginPath();
    g.moveTo(32, 50);
    g.bezierCurveTo(6, 34, 10, 14, 22, 16);
    g.bezierCurveTo(28, 17, 31, 22, 32, 26);
    g.bezierCurveTo(33, 22, 36, 17, 42, 16);
    g.bezierCurveTo(54, 14, 58, 34, 32, 50);
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "paw") {
    g.beginPath();
    g.ellipse(32, 40, 12, 9, 0, 0, Math.PI * 2);
    seal(g);
    for (const [x, y] of [
      [16, 26],
      [25, 17],
      [39, 17],
      [48, 26],
    ] as const) {
      g.beginPath();
      g.ellipse(x, y, 5, 6.2, 0, 0, Math.PI * 2);
      seal(g);
    }
    return;
  }
  if (icon === "mug") {
    g.beginPath();
    g.roundRect(14, 18, 26, 26, 4);
    seal(g);
    g.beginPath();
    g.arc(42, 30, 7, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    g.fillStyle = INK;
    g.fillRect(18, 22, 18, 3);
    return;
  }
  if (icon === "tent") {
    g.beginPath();
    g.moveTo(8, 50);
    g.lineTo(32, 12);
    g.lineTo(56, 50);
    g.closePath();
    seal(g);
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(32, 50);
    g.lineTo(26, 50);
    g.lineTo(32, 32);
    g.closePath();
    g.fill();
    return;
  }
  if (icon === "car") {
    g.beginPath();
    g.roundRect(10, 28, 44, 16, 6);
    seal(g);
    g.beginPath();
    g.moveTo(18, 28);
    g.lineTo(24, 16);
    g.lineTo(42, 16);
    g.lineTo(48, 28);
    g.closePath();
    seal(g);
    inkDots(g, [
      [18, 44, 5],
      [46, 44, 5],
    ]);
    return;
  }
  if (icon === "compass") {
    g.beginPath();
    g.arc(32, 32, 18, 0, Math.PI * 2);
    seal(g);
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(32, 16);
    g.lineTo(36, 34);
    g.lineTo(32, 30);
    g.lineTo(28, 34);
    g.closePath();
    g.fill();
    return;
  }
  if (icon === "plane") {
    g.beginPath();
    g.moveTo(32, 8);
    g.lineTo(38, 28);
    g.lineTo(54, 34);
    g.lineTo(54, 38);
    g.lineTo(38, 36);
    g.lineTo(36, 52);
    g.lineTo(32, 52);
    g.lineTo(30, 36);
    g.lineTo(10, 38);
    g.lineTo(10, 34);
    g.lineTo(26, 28);
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "pack") {
    g.beginPath();
    g.roundRect(16, 18, 32, 32, 6);
    seal(g);
    g.beginPath();
    g.roundRect(24, 10, 16, 12, 5);
    g.stroke();
    g.fillStyle = INK;
    g.fillRect(22, 30, 20, 3);
    return;
  }
  if (icon === "camera") {
    g.beginPath();
    g.roundRect(8, 20, 48, 30, 6);
    seal(g);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(32, 35, 8, 0, Math.PI * 2);
    g.fill();
    g.fillRect(18, 14, 12, 8);
    return;
  }
  if (icon === "sun") {
    g.beginPath();
    g.arc(32, 32, 10, 0, Math.PI * 2);
    seal(g);
    g.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i * Math.PI) / 4;
      g.moveTo(32 + Math.cos(angle) * 14, 32 + Math.sin(angle) * 14);
      g.lineTo(32 + Math.cos(angle) * 22, 32 + Math.sin(angle) * 22);
    }
    g.stroke();
    return;
  }
  if (icon === "moon") {
    g.beginPath();
    g.arc(30, 32, 16, Math.PI * 0.5, Math.PI * 1.5);
    g.arc(38, 32, 12, Math.PI * 1.5, Math.PI * 0.5, true);
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "leaf") {
    g.beginPath();
    g.moveTo(18, 50);
    g.bezierCurveTo(8, 28, 22, 8, 48, 12);
    g.bezierCurveTo(36, 28, 36, 40, 18, 50);
    g.closePath();
    seal(g);
    g.beginPath();
    g.moveTo(22, 44);
    g.quadraticCurveTo(32, 30, 44, 16);
    g.stroke();
    return;
  }
  if (icon === "peak") {
    g.beginPath();
    g.moveTo(32, 10);
    g.lineTo(56, 50);
    g.lineTo(8, 50);
    g.closePath();
    seal(g);
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(32, 28);
    g.lineTo(40, 50);
    g.lineTo(24, 50);
    g.closePath();
    g.fill();
    return;
  }
  if (icon === "fish") {
    g.beginPath();
    g.ellipse(28, 32, 16, 10, 0, 0, Math.PI * 2);
    seal(g);
    g.beginPath();
    g.moveTo(44, 32);
    g.lineTo(56, 20);
    g.lineTo(56, 44);
    g.closePath();
    seal(g);
    inkDots(g, [[18, 30, 2]]);
    return;
  }
  if (icon === "bird") {
    g.beginPath();
    g.moveTo(6, 36);
    g.quadraticCurveTo(20, 14, 32, 32);
    g.quadraticCurveTo(44, 14, 58, 36);
    g.quadraticCurveTo(44, 30, 32, 40);
    g.quadraticCurveTo(20, 30, 6, 36);
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "boot") {
    g.beginPath();
    g.moveTo(22, 8);
    g.lineTo(34, 8);
    g.lineTo(36, 28);
    g.lineTo(52, 34);
    g.lineTo(52, 48);
    g.lineTo(16, 48);
    g.lineTo(16, 36);
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "flag") {
    g.fillRect(16, 10, 4, 42);
    g.strokeRect(16, 10, 4, 42);
    g.beginPath();
    g.moveTo(20, 12);
    g.lineTo(50, 20);
    g.lineTo(20, 30);
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "bolt") {
    g.beginPath();
    g.moveTo(36, 6);
    g.lineTo(14, 36);
    g.lineTo(30, 36);
    g.lineTo(26, 58);
    g.lineTo(50, 26);
    g.lineTo(34, 26);
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "anchor") {
    g.beginPath();
    g.arc(32, 16, 6, 0, Math.PI * 2);
    seal(g);
    g.fillRect(30, 20, 4, 26);
    g.beginPath();
    g.arc(32, 42, 14, 0, Math.PI, false);
    g.stroke();
    g.beginPath();
    g.moveTo(18, 40);
    g.lineTo(14, 50);
    g.lineTo(24, 46);
    g.moveTo(46, 40);
    g.lineTo(50, 50);
    g.lineTo(40, 46);
    g.stroke();
    return;
  }
  if (icon === "bike") {
    g.beginPath();
    g.arc(18, 42, 10, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(46, 42, 10, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(18, 42);
    g.lineTo(32, 42);
    g.lineTo(42, 22);
    g.lineTo(28, 22);
    g.moveTo(32, 42);
    g.lineTo(24, 22);
    g.lineTo(42, 22);
    g.stroke();
    return;
  }
  if (icon === "flame") {
    g.beginPath();
    g.moveTo(32, 6);
    g.bezierCurveTo(46, 22, 54, 28, 48, 42);
    g.bezierCurveTo(44, 54, 20, 54, 16, 42);
    g.bezierCurveTo(12, 28, 22, 24, 26, 18);
    g.bezierCurveTo(28, 26, 34, 24, 32, 6);
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "bloom") {
    for (let i = 0; i < 6; i += 1) {
      const angle = (i * Math.PI) / 3;
      g.beginPath();
      g.ellipse(32 + Math.cos(angle) * 10, 32 + Math.sin(angle) * 10, 7, 5, angle, 0, Math.PI * 2);
      seal(g);
    }
    inkDots(g, [[32, 32, 4]]);
    return;
  }
  if (icon === "balloon") {
    g.beginPath();
    g.ellipse(32, 26, 16, 18, 0, 0, Math.PI * 2);
    seal(g);
    g.beginPath();
    g.moveTo(28, 42);
    g.lineTo(32, 48);
    g.lineTo(36, 42);
    g.closePath();
    seal(g);
    g.beginPath();
    g.moveTo(32, 48);
    g.quadraticCurveTo(36, 54, 28, 58);
    g.stroke();
    return;
  }
  if (icon === "ship") {
    g.beginPath();
    g.moveTo(8, 40);
    g.lineTo(56, 40);
    g.lineTo(46, 52);
    g.lineTo(18, 52);
    g.closePath();
    seal(g);
    g.fillRect(30, 12, 4, 28);
    g.beginPath();
    g.moveTo(34, 14);
    g.lineTo(50, 32);
    g.lineTo(34, 32);
    g.closePath();
    seal(g);
    return;
  }
  if (icon === "cat") {
    g.beginPath();
    g.arc(32, 36, 14, 0, Math.PI * 2);
    seal(g);
    g.beginPath();
    g.moveTo(18, 28);
    g.lineTo(12, 12);
    g.lineTo(28, 22);
    g.closePath();
    seal(g);
    g.beginPath();
    g.moveTo(46, 28);
    g.lineTo(52, 12);
    g.lineTo(36, 22);
    g.closePath();
    seal(g);
    inkDots(g, [
      [26, 36, 2.2],
      [38, 36, 2.2],
    ]);
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(32, 39);
    g.lineTo(29, 43);
    g.lineTo(35, 43);
    g.closePath();
    g.fill();
    return;
  }
  if (icon === "gem") {
    g.beginPath();
    g.moveTo(32, 8);
    g.lineTo(52, 24);
    g.lineTo(32, 56);
    g.lineTo(12, 24);
    g.closePath();
    seal(g);
    g.beginPath();
    g.moveTo(12, 24);
    g.lineTo(52, 24);
    g.moveTo(32, 8);
    g.lineTo(32, 56);
    g.stroke();
    return;
  }
  if (icon === "key") {
    g.beginPath();
    g.arc(22, 26, 10, 0, Math.PI * 2);
    seal(g);
    inkDots(g, [[22, 26, 4]]);
    g.fillRect(30, 23, 24, 6);
    g.fillRect(44, 29, 4, 8);
    g.fillRect(50, 29, 4, 6);
    return;
  }
  if (icon === "mushroom") {
    g.beginPath();
    g.arc(32, 30, 18, Math.PI, 0);
    g.lineTo(14, 34);
    g.closePath();
    seal(g);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(24, 26, 3, 0, Math.PI * 2);
    g.arc(36, 22, 2.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(26, 32, 12, 18, 3);
    seal(g);
    return;
  }
  if (icon === "cloud") {
    g.beginPath();
    g.arc(24, 36, 10, 0, Math.PI * 2);
    g.arc(38, 32, 14, 0, Math.PI * 2);
    g.arc(48, 40, 8, 0, Math.PI * 2);
    seal(g);
    return;
  }
  if (icon === "tree") {
    g.beginPath();
    g.moveTo(32, 6);
    g.lineTo(50, 28);
    g.lineTo(42, 28);
    g.lineTo(52, 44);
    g.lineTo(12, 44);
    g.lineTo(22, 28);
    g.lineTo(14, 28);
    g.closePath();
    seal(g);
    g.fillRect(28, 44, 8, 10);
    return;
  }
  if (icon === "wave") {
    g.beginPath();
    g.moveTo(6, 28);
    g.quadraticCurveTo(16, 14, 26, 28);
    g.quadraticCurveTo(36, 42, 46, 28);
    g.quadraticCurveTo(52, 20, 58, 26);
    g.lineTo(58, 40);
    g.quadraticCurveTo(46, 52, 32, 40);
    g.quadraticCurveTo(20, 30, 6, 42);
    g.closePath();
    seal(g);
    return;
  }
  g.beginPath();
  g.arc(32, 32, 16, 0, Math.PI * 2);
  seal(g);
}

/** Paint a location badge into a square canvas context, origin at the top left. */
export function paintYouMarker(g: Pen, icon: string, color: string, size: number) {
  g.clearRect(0, 0, size, size);
  g.save();
  g.scale(size / 64, size / 64);
  g.fillStyle = color;
  g.strokeStyle = INK;
  g.lineWidth = 3.25;
  g.lineJoin = "round";
  g.lineCap = "round";
  drawIcon(g, isMarkerIcon(icon) ? icon : DEFAULT_MARKER_ICON);
  g.restore();
}

export function youMarkerImage(icon: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("No canvas");
  paintYouMarker(g, icon, color, 64);
  return g.getImageData(0, 0, 64, 64);
}
