import { nativeApp } from "@/lib/native";

const STEPS = [
  {
    title: "The American Atlas",
    body: "Add the places you've been. They stay on the map, and the points add up into badges.",
  },
  {
    title: "Start with a state",
    body: "Tap a state, then zoom in for smaller towns.",
  },
  {
    title: "Add a place",
    body: "Tap a dot, then Add to map.",
  },
  {
    title: "Go back again",
    body: "Visit again to log another stop. Repeat visits earn fewer points.",
  },
  {
    title: "Build a route",
    body: "A trip draws your places in order on the map.",
  },
  {
    title: "Take it with you",
    body: nativeApp
      ? "Sign in to keep your places with your account."
      : "Turn on Offline atlas in Settings to use it with no signal.",
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
