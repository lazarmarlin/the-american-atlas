/**
 * Miles driven per day while tracking, kept on the account for the recap
 * (src/lib/recap.ts).
 *
 * Distance only counts once you've moved 200 m in a straight line from the
 * last counted spot, so GPS wobble at a stop never adds up; a jump of more
 * than 25 miles (tracking was off, GPS lost) is skipped rather than counted.
 *
 * Each device keeps its own running total per day and uploads the totals, not
 * increments, so a retried upload can never double count. The recap adds up
 * all of an account's devices.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

const STEP_METERS = 200;
const JUMP_MILES = 25;
const KEEP_DAYS = 400;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_RE = /^[a-z0-9]{8,40}$/;

// ---------------------------------------------------------------- server

export const saveDriveDays = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const deviceId = String(row.deviceId ?? "");
    if (!DEVICE_RE.test(deviceId)) throw new Error("Bad device");
    const days = Array.isArray(row.days) ? row.days.slice(0, 60) : [];
    return {
      deviceId,
      days: days
        .map((d) => {
          const day = String((d as { day?: unknown })?.day ?? "");
          const miles = Number((d as { miles?: unknown })?.miles);
          return DAY_RE.test(day) && Number.isFinite(miles) && miles >= 0 && miles <= 2000
            ? { day, miles: Math.round(miles * 100) / 100 }
            : null;
        })
        .filter((d): d is { day: string; miles: number } => d !== null),
    };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    for (const { day, miles } of data.days) {
      await sql`
        insert into drive_days (user_id, device_id, day, miles)
        values (${context.userId}, ${data.deviceId}, ${day}::date, ${miles})
        on conflict (user_id, device_id, day) do update set miles = greatest(drive_days.miles, excluded.miles)
      `;
    }
    return { ok: true as const };
  });

// ---------------------------------------------------------------- device

type Log = { totals: Record<string, number>; dirty: string[] };

let userId: string | null = null;
let log: Log = { totals: {}, dirty: [] };
let anchor: { lat: number; lon: number } | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const storageKey = (id: string) => `atlas.drive-log.${id}`;

/** A random id for this install, kept in local storage. */
export function deviceId() {
  try {
    let id = window.localStorage.getItem("atlas.device-id");
    if (!id || !DEVICE_RE.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
        (b % 36).toString(36),
      ).join("");
      window.localStorage.setItem("atlas.device-id", id);
    }
    return id;
  } catch {
    return "nostorage0";
  }
}

/** Local calendar day, YYYY-MM-DD. */
export function localDay(t: number) {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function miles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function persist() {
  if (!userId) return;
  try {
    const days = Object.keys(log.totals).sort();
    for (const old of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete log.totals[old];
    window.localStorage.setItem(storageKey(userId), JSON.stringify(log));
  } catch {
    /* storage full or blocked: the totals still upload from memory */
  }
}

/** Switch to the signed-in account's log (null when signed out). */
export function switchDriveLog(next: string | null) {
  if (next === userId) return;
  userId = next;
  anchor = null;
  log = { totals: {}, dirty: [] };
  if (!next) return;
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey(next)) ?? "null") as Log | null;
    if (raw && typeof raw.totals === "object")
      log = { totals: raw.totals, dirty: Array.isArray(raw.dirty) ? raw.dirty : [] };
  } catch {
    /* start fresh */
  }
  scheduleFlush(5_000);
}

/** Feed tracking fixes in time order. */
export function logDrive(fixes: { lat: number; lon: number; t?: number }[]) {
  if (!userId) return;
  let changed = false;
  for (const fix of fixes) {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) continue;
    if (!anchor) {
      anchor = { lat: fix.lat, lon: fix.lon };
      continue;
    }
    const step = miles(anchor, fix);
    if (step * 1609.344 < STEP_METERS) continue;
    anchor = { lat: fix.lat, lon: fix.lon };
    if (step > JUMP_MILES) continue;
    const day = localDay(fix.t ?? Date.now());
    log.totals[day] = (log.totals[day] ?? 0) + step;
    if (!log.dirty.includes(day)) log.dirty.push(day);
    changed = true;
  }
  if (changed) {
    persist();
    scheduleFlush(120_000);
  }
}

function scheduleFlush(ms: number) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDriveLog();
  }, ms);
}

/** Upload changed days now (on a timer, when the app goes to the background, before the recap opens). */
export async function flushDriveLog() {
  if (!userId || !log.dirty.length) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const owner = userId;
  const days = log.dirty.slice(0, 60).map((day) => ({ day, miles: log.totals[day] ?? 0 }));
  try {
    await saveDriveDays({ data: { deviceId: deviceId(), days } });
    if (owner !== userId) return;
    const sent = new Set(days.map((d) => d.day));
    // A day that grew while uploading stays dirty: its new total goes next time.
    log.dirty = log.dirty.filter(
      (day) =>
        !sent.has(day) || (log.totals[day] ?? 0) > (days.find((d) => d.day === day)?.miles ?? 0),
    );
    persist();
  } catch {
    scheduleFlush(300_000);
  }
}

/** Miles tracked today on this phone. */
export function todayMiles() {
  return log.totals[localDay(Date.now())] ?? 0;
}
