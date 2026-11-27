/**
 * Weather ahead, for the drive dashboard: what the sky will be doing where
 * you'll be in the next hour or so, from Open-Meteo (free, no key). It looks
 * at three points along the way you're going (about 15, 35 and 60 miles out),
 * each for the hour you'd get there at this speed, and reports the first one
 * worth knowing about ("Rain in 35 mi"), or "Clear ahead · 54°".
 */

export type WeatherKind = "clear" | "cloud" | "fog" | "rain" | "storm" | "snow" | "ice";

export type WeatherAhead = {
  /** One line for the dashboard. */
  line: string;
  kind: WeatherKind;
  /** Rain, snow, ice, storms or fog somewhere ahead: worth saying out loud. */
  heads: boolean;
  /** Miles to the first bad patch, if any. */
  miles: number | null;
  tempF: number | null;
  at: number;
};

type Point = { lat: number; lon: number };

const AHEAD_MILES = [15, 35, 60];

function along(from: Point, bearing: number, miles: number): Point {
  const rad = (bearing * Math.PI) / 180;
  return {
    lat: from.lat + (miles * Math.cos(rad)) / 69,
    lon: from.lon + (miles * Math.sin(rad)) / (69 * Math.cos((from.lat * Math.PI) / 180)),
  };
}

/** WMO weather codes (what Open-Meteo returns) to a few kinds that matter on the road. */
export function kindOfCode(code: number): WeatherKind {
  if (code >= 95) return "storm";
  if (code === 56 || code === 57 || code === 66 || code === 67) return "ice";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82)) return "rain";
  if (code === 45 || code === 48) return "fog";
  if (code === 2 || code === 3) return "cloud";
  return "clear";
}

const WORDS: Record<WeatherKind, string> = {
  clear: "Clear",
  cloud: "Cloudy",
  fog: "Fog",
  rain: "Rain",
  storm: "Storms",
  snow: "Snow",
  ice: "Freezing rain",
};

const BAD: WeatherKind[] = ["fog", "rain", "storm", "snow", "ice"];
const RANK: Record<WeatherKind, number> = { clear: 0, cloud: 1, fog: 2, rain: 3, snow: 4, ice: 5, storm: 6 };

type Hourly = { time: string[]; weather_code: number[]; temperature_2m: number[]; precipitation_probability?: (number | null)[] };

let last: { key: string; result: WeatherAhead } | null = null;

/**
 * Weather along the way. `bearing` null (not moving): just here. Asks at most
 * every 15 minutes or 20 miles; otherwise returns the last answer.
 */
export async function weatherAhead(fix: Point, bearing: number | null, mph: number, force = false): Promise<WeatherAhead | null> {
  const key = `${Math.round(fix.lat * 3)}:${Math.round(fix.lon * 3)}:${bearing == null ? "-" : Math.round(bearing / 45)}`;
  if (!force && last && Date.now() - last.result.at < 15 * 60_000 && last.key === key) return last.result;
  const speed = Math.max(mph, 25);
  const spots = bearing == null ? [{ miles: 0, at: fix }] : AHEAD_MILES.map((miles) => ({ miles, at: along(fix, bearing, miles) }));
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", spots.map((spot) => spot.at.lat.toFixed(3)).join(","));
  url.searchParams.set("longitude", spots.map((spot) => spot.at.lon.toFixed(3)).join(","));
  url.searchParams.set("hourly", "weather_code,temperature_2m,precipitation_probability");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("forecast_hours", "4");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return last?.result ?? null;
    const body = (await res.json()) as { hourly?: Hourly } | { hourly?: Hourly }[];
    const rows = (Array.isArray(body) ? body : [body]).map((row) => row.hourly);
    const now = Date.now();
    let worst: { kind: WeatherKind; miles: number } | null = null;
    let here: { kind: WeatherKind; temp: number | null } | null = null;
    spots.forEach((spot, index) => {
      const hourly = rows[index];
      if (!hourly?.time?.length) return;
      // The hour you'd be there.
      const arrive = now + (spot.miles / speed) * 3_600_000;
      let pick = 0;
      hourly.time.forEach((time, i) => {
        if (Date.parse(`${time}Z`) <= arrive) pick = i;
      });
      const code = Number(hourly.weather_code[pick]);
      const chance = hourly.precipitation_probability?.[pick];
      let kind = kindOfCode(Number.isFinite(code) ? code : 0);
      // A code for showers with a small chance isn't worth a warning.
      if ((kind === "rain" || kind === "snow") && chance != null && chance < 35) kind = "cloud";
      const temp = Number(hourly.temperature_2m[pick]);
      if (index === 0) here = { kind, temp: Number.isFinite(temp) ? Math.round(temp) : null };
      if (BAD.includes(kind) && (!worst || RANK[kind] > RANK[worst.kind])) worst = { kind, miles: spot.miles };
    });
    if (!here) return last?.result ?? null;
    const near = here as { kind: WeatherKind; temp: number | null };
    const temp = near.temp;
    const bad = worst as { kind: WeatherKind; miles: number } | null;
    const result: WeatherAhead = bad
      ? {
          line: `${WORDS[bad.kind]} ${bad.miles ? `in about ${bad.miles} mi` : "here"}${temp != null ? ` · ${temp}°` : ""}`,
          kind: bad.kind,
          heads: true,
          miles: bad.miles,
          tempF: temp,
          at: now,
        }
      : {
          line: `${near.kind === "cloud" ? "Cloudy" : "Clear"} ${bearing == null ? "here" : "ahead"}${temp != null ? ` · ${temp}°` : ""}`,
          kind: near.kind,
          heads: false,
          miles: null,
          tempF: temp,
          at: now,
        };
    last = { key, result };
    return result;
  } catch {
    return last?.result ?? null;
  }
}

/** What to say out loud when the weather ahead turns (once per change). */
export function weatherSpeech(result: WeatherAhead) {
  if (!result.heads) return null;
  const what = WORDS[result.kind].toLowerCase();
  return result.miles ? `Heads up: ${what} in about ${result.miles} miles.` : `Heads up: ${what} here.`;
}
