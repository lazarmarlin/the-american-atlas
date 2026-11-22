import { nativeApp } from "@/lib/native";

const STEPS = [
  {
    title: "The American Atlas",
    body: "Add the places you've been. They stay on the map, and the points add up into badges.",
  },
  {
    title: "Start with a state",
    body: "Tap a state. Highways, cities, and parks show first. Zoom in and smaller towns appear. Places you've added stay visible when you zoom back out.",
  },
  {
    title: "Add a place",
    body: "Tap a dot, then Add to map. A date, note, or photo is optional. You can skip it and add the place in one tap.",
  },
  {
    title: "Go back again",
    body: "Visit again records another time there. The first visit is full points, then 85%, 50%, 25%, and 10%. After that it is still tracked, and it just stops adding points.",
  },
  {
    title: "Build a route",
    body: "A trip draws your places in order. The same place can be on it twice, so a drive can leave Erie, cross into Ohio, and come home.",
  },
  {
    title: "Take it with you",
    body: nativeApp
      ? "The places, roads, and counties are already on this phone. Sign in and they stay with your account. You can replay this tour in Settings."
      : "In Settings, turn on Offline atlas. A progress bar runs while every place is saved on this device. You can replay this tour there too.",
  },
];

export function Tour({ step, onStep, onDone }: { step: number; onStep: (step: number) => void; onDone: () => void }) {
  const current = STEPS[Math.min(STEPS.length - 1, Math.max(0, step))] ?? STEPS[0];
  const last = step >= STEPS.length - 1;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md rounded-card border border-line bg-surface px-4 py-4 text-ink shadow-lg" role="dialog" aria-labelledby="tour-title">
        <p className="text-xs tracking-widest text-faint uppercase">
          {step + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title" className="mt-1 font-serif text-3xl leading-none">
          {current.title}
        </h2>
        <p className="mt-3 text-sm leading-snug text-muted">{current.body}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onDone} className="h-11 rounded-lg border border-line px-4 text-sm text-muted">
            Skip
          </button>
          <button
            type="button"
            onClick={() => (last ? onDone() : onStep(step + 1))}
            className="h-11 flex-1 rounded-lg bg-accent text-sm font-medium text-accent-ink"
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
