/** Sunrise and sunset (NOAA's formula, to a minute or two), as ms. Null where the sun doesn't set or rise that day. */
export function sunTimes(lat: number, lon: number, day = new Date()): { rise: number | null; set: number | null } {
  const rad = Math.PI / 180;
  const start = Date.UTC(day.getUTCFullYear(), 0, 0);
  const n = Math.floor((Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - start) / 86400000);
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH > 1 || cosH < -1) return { rise: null, set: null };
  const ha = Math.acos(cosH) / rad;
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const rise = midnight + (720 - 4 * (lon + ha) - eqt) * 60000;
  const set = midnight + (720 - 4 * (lon - ha) - eqt) * 60000;
  return { rise, set };
}

/** Dark now (after sunset or before sunrise), or within `soon` ms of sunset. */
export function isDark(lat: number, lon: number, now = Date.now(), soon = 0) {
  const today = sunTimes(lat, lon, new Date(now));
  if (today.set == null || today.rise == null) return false;
  // A US evening runs past midnight UTC: look at yesterday's sunset too.
  const yesterday = sunTimes(lat, lon, new Date(now - 86400000));
  const sets = [today.set, yesterday.set ?? today.set - 86400000];
  const rises = [today.rise, sunTimes(lat, lon, new Date(now + 86400000)).rise ?? today.rise + 86400000];
  for (const set of sets) {
    const nextRise = rises.find((r) => r > set) ?? set + 12 * 3600000;
    if (now >= set - soon && now < nextRise) return true;
  }
  return false;
}
