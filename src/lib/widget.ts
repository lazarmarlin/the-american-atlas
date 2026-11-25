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
    const days = mark.visits.map((visit) => visit.visitedOn);
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

export function updateWidget(marks: Mark[], tracking: boolean) {
  if (!nativeApp) return;
  const data = widgetNumbers(marks, tracking);
  const key = JSON.stringify(data);
  if (key === lastSent) return;
  lastSent = key;
  void Widget.update(data).catch(() => {
    lastSent = "";
  });
}
