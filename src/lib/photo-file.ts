/**
 * Read a camera-roll photo: the location stored in the file, a small thumbnail,
 * and a larger jpeg the gallery can keep. Matching only uses places already added.
 */
function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 3958.8;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type PhotoGps = { lat: number; lon: number; takenAt: number | null };

const LIMITS: Record<string, number> = {
  county: 20,
  city: 8,
  town: 5,
  reservation: 12,
  park: 2,
};

export function matchPlace<T extends { id: string; name: string; lat: number | null; lon: number | null; category: string }>(
  lat: number,
  lon: number,
  marks: T[],
): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const mark of marks) {
    if (mark.lat == null || mark.lon == null) continue;
    const miles = milesBetween(lat, lon, mark.lat, mark.lon);
    const limit = LIMITS[mark.category] ?? 0.75;
    if (miles > limit) continue;
    const score = miles / limit;
    if (score < bestScore) {
      best = mark;
      bestScore = score;
    }
  }
  return best;
}

export async function readPhotoFile(file: File): Promise<{ gps: PhotoGps | null; thumb: string; image: string }> {
  const buffer = await file.arrayBuffer();
  const gps = readGps(buffer);
  const image = await shrinkImage(file, 720, 0.72, 160000);
  const thumb = await shrinkImage(file, 96, 0.62, 40000);
  return { gps, thumb, image };
}

export function readGps(buffer: ArrayBuffer): PhotoGps | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) break;
    const size = view.getUint16(offset + 2);
    if (size < 2 || offset + 2 + size > view.byteLength) break;
    if (marker === 0xe1) {
      const hit = readExif(view, offset + 4, size - 2);
      if (hit) return hit;
    }
    offset += 2 + size;
  }
  return null;
}

function readExif(view: DataView, start: number, length: number): PhotoGps | null {
  if (length < 14) return null;
  const ascii = (index: number, count: number) => {
    let text = "";
    for (let i = 0; i < count; i += 1) text += String.fromCharCode(view.getUint8(start + index + i));
    return text;
  };
  if (ascii(0, 4) !== "Exif" || view.getUint8(start + 4) !== 0 || view.getUint8(start + 5) !== 0) return null;
  const tiff = start + 6;
  const little = ascii(6, 2) === "II";
  const get16 = (at: number) => view.getUint16(tiff + at, little);
  const get32 = (at: number) => view.getUint32(tiff + at, little);
  if (get16(2) !== 42) return null;
  const gpsAt = findIfd(get16, get32, get32(4), 0x8825);
  if (gpsAt == null) return null;
  const lat = readGpsCoord(view, tiff, little, gpsAt, 0x0002, 0x0001);
  const lon = readGpsCoord(view, tiff, little, gpsAt, 0x0004, 0x0003);
  if (lat == null || lon == null) return null;
  const exifAt = findIfd(get16, get32, get32(4), 0x8769);
  const takenAt = exifAt == null ? null : readExifDate(view, tiff, little, exifAt);
  return { lat, lon, takenAt };
}

function findIfd(get16: (at: number) => number, get32: (at: number) => number, ifd: number, tag: number): number | null {
  if (ifd <= 0) return null;
  const count = get16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (get16(entry) !== tag) continue;
    return get32(entry + 8);
  }
  return null;
}

function readGpsCoord(
  view: DataView,
  tiff: number,
  little: boolean,
  gpsIfd: number,
  valueTag: number,
  refTag: number,
): number | null {
  const count = view.getUint16(tiff + gpsIfd, little);
  let ref = "";
  let offset = 0;
  let found = false;
  for (let i = 0; i < count; i += 1) {
    const entry = gpsIfd + 2 + i * 12;
    const tag = view.getUint16(tiff + entry, little);
    const type = view.getUint16(tiff + entry + 2, little);
    if (tag === refTag && type === 2) {
      ref = String.fromCharCode(view.getUint8(tiff + entry + 8));
    }
    if (tag === valueTag && type === 5) {
      offset = view.getUint32(tiff + entry + 8, little);
      found = true;
    }
  }
  if (!found) return null;
  const parts = [0, 1, 2].map((index) => {
    const at = tiff + offset + index * 8;
    const num = view.getUint32(at, little);
    const den = view.getUint32(at + 4, little);
    return den ? num / den : 0;
  });
  const value = parts[0]! + parts[1]! / 60 + parts[2]! / 3600;
  return ref === "S" || ref === "W" ? -value : value;
}

function readExifDate(view: DataView, tiff: number, little: boolean, exifIfd: number): number | null {
  const count = view.getUint16(tiff + exifIfd, little);
  for (let i = 0; i < count; i += 1) {
    const entry = exifIfd + 2 + i * 12;
    if (view.getUint16(tiff + entry, little) !== 0x9003) continue;
    const size = view.getUint32(tiff + entry + 4, little);
    const offset = size <= 4 ? tiff + entry + 8 : tiff + view.getUint32(tiff + entry + 8, little);
    let text = "";
    for (let c = 0; c < Math.min(size, 19); c += 1) text += String.fromCharCode(view.getUint8(offset + c));
    const match = text.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!match) return null;
    const when = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
    return Number.isFinite(when) ? when : null;
  }
  return null;
}

function shrinkImage(file: File, edge: number, quality: number, max: number) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, edge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const g = canvas.getContext("2d");
        if (!g) {
          reject(new Error("Couldn't read that photo"));
          return;
        }
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        let q = quality;
        let url = canvas.toDataURL("image/jpeg", q);
        while (url.length > max && q > 0.4) {
          q -= 0.1;
          url = canvas.toDataURL("image/jpeg", q);
        }
        if (url.length > max) reject(new Error("Use a smaller photo"));
        else resolve(url);
      };
      img.onerror = () => reject(new Error("Couldn't read that photo"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
