/** The Android home-screen widget's numbers (AtlasWidget.java / WidgetPlugin.java). */
import { registerPlugin } from "@capacitor/core";
import { nativeApp } from "@/lib/native";
import { localDay } from "@/lib/drive-log";
import { pointsForVisit } from "@/lib/visits";
import type { Mark } from "@/lib/marks";

type WidgetData = { day: string; today: number; monthPoints: number; places: number; tracking: boolean; last: string };

const Widget = registerPlugin<{ update(data: WidgetData): Promise<void> }>("AtlasWidget");

/** New places today (first visit today), the latest of them, and points earned this month. */
export function widgetNumbers(marks: Mark[], tracking: boolean, now = Date.now()): WidgetData {
  const day = localDay(now);
  const month = day.slice(0, 7);
  let today = 0;
  let monthPoints = 0;
  let last = "";
  for (const mark of marks) {
    // Undated visits fall back to the place's own date (the server refines this).
    const fallback = mark.visitedOn;
    const days = (mark.visits.length ? mark.visits : [null]).map((visit) => visit?.visitedOn ?? fallback);
    const first = days.filter((d): d is string => !!d).sort()[0];
    if (first === day) {
      today += 1;
      // Newest places come first in the list.
      if (!last) last = mark.name;
    }
    days.forEach((d, index) => {
      if (d && d.startsWith(month)) monthPoints += pointsForVisit(mark.points, index);
    });
  }
  return { day, today, monthPoints: Math.round(monthPoints), places: marks.length, tracking, last };
}

let lastSent = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let latest: { marks: Mark[]; tracking: boolean } | null = null;

function send(data: WidgetData) {
  const key = JSON.stringify(data);
  if (key === lastSent) return;
  lastSent = key;
  void Widget.update(data).catch(() => {
    lastSent = "";
  });
}

/**
 * Update the widget. The quick count from the places on the phone goes first;
 * then the same totals the Recap tab shows (worked out on the server, which
 * dates older visits by when the place was saved and uses the atlas's own
 * points), so the widget and the app agree.
 */
export function updateWidget(marks: Mark[], tracking: boolean) {
  if (!nativeApp) return;
  latest = { marks, tracking };
  const quick = widgetNumbers(marks, tracking);
  send(quick);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void refine(), 4000);
}

async function refine() {
  timer = null;
  if (!latest) return;
  const { marks, tracking } = latest;
  try {
    const { getRecap, periodRange } = await import("@/lib/recap");
    const month = periodRange("month");
    const day = localDay(Date.now());
    const [monthRecap, todayRecap] = await Promise.all([
      getRecap({ data: { from: month.from, to: month.to, tz: month.tz } }),
      getRecap({ data: { from: day, to: day, tz: month.tz } }),
    ]);
    const quick = widgetNumbers(marks, tracking);
    send({ ...quick, monthPoints: monthRecap.points, today: Math.max(quick.today, todayRecap.places) });
  } catch {
    // Offline: the quick count stays.
  }
}
