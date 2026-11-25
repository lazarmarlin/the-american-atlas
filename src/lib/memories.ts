/**
 * "On this day" memories and visit streaks, worked out on the device from the
 * dated visits already on each place. Nothing new is stored on the account.
 */
import type { Mark } from "@/lib/marks";
import { localDay } from "@/lib/drive-log";
import { nativeApp } from "@/lib/native";

export type Memory = { mark: Mark; day: string; years: number };

/** Places you visited on this calendar day in earlier years, most years ago first. */
export function onThisDay(marks: Mark[], today = localDay(Date.now())): Memory[] {
  const md = today.slice(5);
  const year = Number(today.slice(0, 4));
  const out: Memory[] = [];
  for (const mark of marks) {
    // The earliest visit on this date: "3 years ago" beats "1 year ago" for the same place.
    const day = mark.visits
      .map((visit) => visit.visitedOn)
      .filter((d): d is string => !!d && d.slice(5) === md && Number(d.slice(0, 4)) < year)
      .sort()[0];
    if (day) out.push({ mark, day, years: year - Number(day.slice(0, 4)) });
  }
  return out.sort((a, b) => b.years - a.years || b.mark.points - a.mark.points || a.mark.name.localeCompare(b.mark.name));
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d.getTime());
}

/** Monday of the week a day is in. */
function weekOf(day: string) {
  const d = new Date(`${day}T12:00:00`);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return localDay(d.getTime());
}

export type Streaks = {
  /** Days in a row, up to today (or yesterday), with any visit. */
  days: number;
  /** Weeks in a row, up to this week (or last), with at least one new place. */
  weeks: number;
  bestWeeks: number;
  /** True when today (or this week) already counts, false when it's waiting on you. */
  dayDone: boolean;
  weekDone: boolean;
};

export function streaks(marks: Mark[], today = localDay(Date.now())): Streaks {
  const visitDays = new Set<string>();
  const newWeeks = new Set<string>();
  for (const mark of marks) {
    const days = mark.visits.map((visit) => visit.visitedOn).filter((d): d is string => !!d).sort();
    for (const day of days) visitDays.add(day);
    if (days[0]) newWeeks.add(weekOf(days[0]));
  }
  const dayDone = visitDays.has(today);
  let days = 0;
  for (let day = dayDone ? today : addDays(today, -1); visitDays.has(day); day = addDays(day, -1)) days += 1;

  const thisWeek = weekOf(today);
  const weekDone = newWeeks.has(thisWeek);
  let weeks = 0;
  for (let week = weekDone ? thisWeek : addDays(thisWeek, -7); newWeeks.has(week); week = addDays(week, -7)) weeks += 1;

  let bestWeeks = 0;
  for (const week of newWeeks) {
    if (newWeeks.has(addDays(week, -7))) continue;
    let run = 0;
    for (let w = week; newWeeks.has(w); w = addDays(w, 7)) run += 1;
    bestWeeks = Math.max(bestWeeks, run);
  }
  return { days, weeks, bestWeeks, dayDone, weekDone };
}

export function yearsAgo(n: number) {
  return n === 1 ? "One year ago today" : `${n} years ago today`;
}

// ---------------------------------------------------------------- reminder

const REMIND_KEY = "atlas.memories-remind";
const SENT_KEY = "atlas.memories-sent";

export function memoryReminders() {
  try {
    return localStorage.getItem(REMIND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setMemoryReminders(on: boolean) {
  try {
    localStorage.setItem(REMIND_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked */
  }
}

/** Once a day, a phone notification for the best "on this day" memory (Android app). */
export async function remindOnThisDay(marks: Mark[]) {
  if (!nativeApp || !memoryReminders()) return;
  const today = localDay(Date.now());
  try {
    if (localStorage.getItem(SENT_KEY) === today) return;
  } catch {
    return;
  }
  const memories = onThisDay(marks, today);
  const top = memories[0];
  if (!top) return;
  try {
    localStorage.setItem(SENT_KEY, today);
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.createChannel({ id: "memories", name: "On this day", description: "Places you visited on this day in past years.", importance: 3 }).catch(() => {});
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") return;
    const more = memories.length > 1 ? ` and ${memories.length - 1} more` : "";
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 7_000_000 + Number(today.replace(/-/g, "").slice(2)),
          title: yearsAgo(top.years),
          body: `${top.mark.name}${more}. Open the Recap tab to look back.`,
          channelId: "memories",
          smallIcon: "ic_stat_atlas",
          iconColor: "#e2b15a",
        },
      ],
    });
  } catch {
    /* a missed reminder is fine */
  }
}
