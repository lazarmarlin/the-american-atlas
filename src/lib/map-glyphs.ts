import { placeKinds } from "@/lib/place-kinds";

function tree(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(16, 5);
  g.lineTo(25, 16);
  g.lineTo(20, 16);
  g.lineTo(24, 22);
  g.lineTo(8, 22);
  g.lineTo(12, 16);
  g.lineTo(7, 16);
  g.closePath();
  g.fill();
  g.fillRect(14, 22, 4, 5);
}

function reservationMark(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(4, 24);
  g.quadraticCurveTo(10, 12, 16, 24);
  g.quadraticCurveTo(22, 13, 28, 24);
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(16, 10, 3.2, 0, Math.PI * 2);
  g.fill();
}

function statePark(g: CanvasRenderingContext2D) {
  g.fillRect(14.2, 20, 3.6, 7);
  g.lineWidth = 1.8;
  g.strokeRect(6.5, 6, 19, 13);
  g.beginPath();
  g.moveTo(16, 8.2);
  g.lineTo(21.5, 16.2);
  g.lineTo(10.5, 16.2);
  g.closePath();
  g.fill();
}

function bridge(g: CanvasRenderingContext2D, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(5, 20);
  g.quadraticCurveTo(16, 6, 27, 20);
  g.stroke();
  g.fillRect(6, 12, 2.4, 10);
  g.fillRect(23.6, 12, 2.4, 10);
  g.fillRect(5, 20, 22, 2.2);
}

function plane(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(16, 4);
  g.lineTo(19, 14);
  g.lineTo(28, 17);
  g.lineTo(28, 19.5);
  g.lineTo(19, 18);
  g.lineTo(17.5, 26);
  g.lineTo(20, 27.5);
  g.lineTo(16, 26.2);
  g.lineTo(12, 27.5);
  g.lineTo(14.5, 26);
  g.lineTo(13, 18);
  g.lineTo(4, 19.5);
  g.lineTo(4, 17);
  g.lineTo(13, 14);
  g.closePath();
  g.fill();
}

function house(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(16, 6);
  g.lineTo(27, 15);
  g.lineTo(23, 15);
  g.lineTo(23, 26);
  g.lineTo(9, 26);
  g.lineTo(9, 15);
  g.lineTo(5, 15);
  g.closePath();
  g.fill();
}

function skyline(g: CanvasRenderingContext2D) {
  g.fillRect(5, 14, 5, 12);
  g.fillRect(12, 7, 6, 19);
  g.fillRect(20, 12, 6, 14);
}

function dome(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.arc(16, 16, 7, Math.PI, 0);
  g.fill();
  g.fillRect(8, 16, 16, 3);
  g.fillRect(6, 20, 20, 3);
  g.fillRect(15, 6, 2, 4);
}

function wave(g: CanvasRenderingContext2D, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(4, 14);
  g.quadraticCurveTo(9, 8, 14, 14);
  g.quadraticCurveTo(19, 20, 24, 14);
  g.quadraticCurveTo(27, 11, 29, 13);
  g.stroke();
  g.beginPath();
  g.moveTo(4, 21);
  g.quadraticCurveTo(9, 15, 14, 21);
  g.quadraticCurveTo(19, 27, 24, 21);
  g.stroke();
}

function oval(g: CanvasRenderingContext2D, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(16, 16, 10, 6, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.ellipse(16, 16, 4, 2.4, 0, 0, Math.PI * 2);
  g.stroke();
}

function tower(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(16, 4);
  g.lineTo(20, 10);
  g.lineTo(18, 10);
  g.lineTo(20, 26);
  g.lineTo(12, 26);
  g.lineTo(14, 10);
  g.lineTo(12, 10);
  g.closePath();
  g.fill();
}

function flower(g: CanvasRenderingContext2D) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath();
    g.arc(16 + Math.cos(a) * 5, 15 + Math.sin(a) * 5, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillRect(15, 18, 2, 8);
}

function mug(g: CanvasRenderingContext2D, color: string) {
  g.fillRect(8, 10, 12, 14);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(20, 16, 4, -1, 1);
  g.stroke();
}

function column(g: CanvasRenderingContext2D) {
  g.fillRect(7, 8, 18, 3);
  g.fillRect(8, 22, 16, 3);
  g.fillRect(11, 11, 2.4, 11);
  g.fillRect(15, 11, 2.4, 11);
  g.fillRect(19, 11, 2.4, 11);
}

function loop(g: CanvasRenderingContext2D, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(16, 14, 6, Math.PI * 0.1, Math.PI * 1.7);
  g.stroke();
  g.fillRect(6, 22, 20, 2);
}

function cart(g: CanvasRenderingContext2D, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeRect(7, 10, 14, 10);
  g.beginPath();
  g.moveTo(7, 14);
  g.lineTo(21, 14);
  g.moveTo(11, 10);
  g.lineTo(11, 20);
  g.moveTo(16, 10);
  g.lineTo(16, 20);
  g.stroke();
  g.beginPath();
  g.arc(11, 24, 1.6, 0, Math.PI * 2);
  g.arc(19, 24, 1.6, 0, Math.PI * 2);
  g.fill();
}

function storefront(g: CanvasRenderingContext2D) {
  g.fillRect(6, 12, 20, 14);
  g.clearRect(9, 16, 5, 10);
  g.clearRect(18, 16, 5, 6);
  g.fillRect(6, 9, 20, 4);
}

function star(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(16, 4);
  g.lineTo(19.2, 12);
  g.lineTo(28, 12.4);
  g.lineTo(21.2, 18);
  g.lineTo(23.4, 26.5);
  g.lineTo(16, 21.8);
  g.lineTo(8.6, 26.5);
  g.lineTo(10.8, 18);
  g.lineTo(4, 12.4);
  g.lineTo(12.8, 12);
  g.closePath();
  g.fill();
}

function diamond(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(16, 5);
  g.lineTo(26, 16);
  g.lineTo(16, 27);
  g.lineTo(6, 16);
  g.closePath();
  g.fill();
}

function peak(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(16, 5);
  g.lineTo(27, 25);
  g.lineTo(5, 25);
  g.closePath();
  g.fill();
}

function animal(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.arc(16, 18, 7, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(9, 14);
  g.lineTo(7, 6);
  g.lineTo(14, 12);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(23, 14);
  g.lineTo(25, 6);
  g.lineTo(18, 12);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(16, 23, 6, 3.2, 0, 0, Math.PI);
  g.fill();
}

function fork(g: CanvasRenderingContext2D) {
  g.fillRect(15, 12, 2, 14);
  g.fillRect(10, 6, 2, 8);
  g.fillRect(15, 6, 2, 8);
  g.fillRect(20, 6, 2, 8);
  g.beginPath();
  g.moveTo(10, 14);
  g.quadraticCurveTo(16, 16, 22, 14);
  g.lineTo(22, 12);
  g.quadraticCurveTo(16, 14, 10, 12);
  g.closePath();
  g.fill();
}

function plate(g: CanvasRenderingContext2D, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(16, 18, 10, 6, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.ellipse(16, 18, 5, 3, 0, 0, Math.PI * 2);
  g.stroke();
}

function wineGlass(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(10, 6);
  g.lineTo(22, 6);
  g.lineTo(17, 16);
  g.quadraticCurveTo(16, 18, 15, 16);
  g.closePath();
  g.fill();
  g.fillRect(15, 16, 2, 8);
  g.fillRect(11, 24, 10, 2);
}

function barrel(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.ellipse(16, 16, 8, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.clearRect(7, 12, 18, 2);
  g.clearRect(7, 18, 18, 2);
}

function screen(g: CanvasRenderingContext2D) {
  g.fillRect(6, 8, 20, 14);
  g.clearRect(8, 10, 16, 10);
  g.fillRect(14, 22, 4, 3);
  g.fillRect(10, 25, 12, 2);
}

function fortWall(g: CanvasRenderingContext2D) {
  g.fillRect(6, 14, 20, 12);
  g.fillRect(6, 10, 4, 6);
  g.fillRect(14, 10, 4, 6);
  g.fillRect(22, 10, 4, 6);
}

function flag(g: CanvasRenderingContext2D) {
  g.fillRect(8, 6, 2, 20);
  g.beginPath();
  g.moveTo(10, 6);
  g.lineTo(24, 10);
  g.lineTo(10, 14);
  g.closePath();
  g.fill();
}

function falls(g: CanvasRenderingContext2D) {
  g.fillRect(8, 6, 16, 3);
  g.fillRect(11, 10, 2, 12);
  g.fillRect(15, 10, 2, 16);
  g.fillRect(19, 10, 2, 13);
}

function caveArch(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(5, 26);
  g.lineTo(5, 14);
  g.quadraticCurveTo(16, 2, 27, 14);
  g.lineTo(27, 26);
  g.lineTo(20, 26);
  g.lineTo(20, 16);
  g.quadraticCurveTo(16, 12, 12, 16);
  g.lineTo(12, 26);
  g.closePath();
  g.fill();
}

function roadBend(g: CanvasRenderingContext2D, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(6, 24);
  g.quadraticCurveTo(8, 10, 16, 12);
  g.quadraticCurveTo(24, 14, 26, 6);
  g.stroke();
}

function drawKind(g: CanvasRenderingContext2D, kind: string, color: string) {
  g.fillStyle = color;
  g.strokeStyle = color;
  if (kind === "park-state") statePark(g);
  else if (kind === "reservation") reservationMark(g);
  else if (kind.startsWith("park") || kind === "forest" || kind === "refuge") tree(g);
  else if (kind.startsWith("span") || kind === "bridge") bridge(g, color);
  else if (kind.startsWith("airport")) plane(g);
  else if (kind === "capitol" || kind === "president") dome(g);
  else if (kind === "beach" || kind === "seashore") wave(g, color);
  else if (kind === "stadium") oval(g, color);
  else if (kind === "lighthouse") tower(g);
  else if (kind === "garden") flower(g);
  else if (kind === "brewery") mug(g, color);
  else if (kind === "winery") wineGlass(g);
  else if (kind === "distillery") barrel(g);
  else if (kind === "historic" || kind === "museum") column(g);
  else if (kind === "battlefield") flag(g);
  else if (kind === "amusement") loop(g, color);
  else if (kind === "drivein") screen(g);
  else if (kind === "fort") fortWall(g);
  else if (kind === "market") cart(g, color);
  else if (kind === "outfitter") cart(g, color);
  else if (kind === "bucee") storefront(g);
  else if (kind === "city") skyline(g);
  else if (kind === "food") fork(g);
  else if (kind === "diner") plate(g, color);
  else if (kind === "zoo") animal(g);
  else if (kind === "town" || kind === "chain") house(g);
  else if (kind === "mall") storefront(g);
  else if (kind === "roadside") star(g);
  else if (kind === "highpoint") peak(g);
  else if (kind === "waterfall") falls(g);
  else if (kind === "cave") caveArch(g);
  else if (kind === "drive") roadBend(g, color);
  else diamond(g);
}

export function glyphImage(kind: string, color: string, saved: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("No canvas");
  if (saved) {
    g.strokeStyle = "#e23d2b";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(16, 16, 14.5, 0, Math.PI * 2);
    g.stroke();
  }
  drawKind(g, kind, color);
  return g.getImageData(0, 0, 32, 32);
}

const urls = new Map<string, string>();

export function glyphUrl(kind: string, color: string) {
  const key = `${kind}:${color}`;
  const cached = urls.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext("2d");
  if (!g) return "";
  drawKind(g, kind, color);
  const url = canvas.toDataURL();
  urls.set(key, url);
  return url;
}

export function glyphKinds() {
  return placeKinds.map((kind) => kind.id);
}
