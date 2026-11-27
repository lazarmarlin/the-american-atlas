/**
 * The games that play themselves in Drive mode, for anyone with the boards:
 * name that county (asked just before a county line), state trivia (asked
 * on crossing into a state), and the state line guess (settled on crossing).
 * Nothing happens unless you have one of those boards.
 */
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { StateInfo } from "@/lib/atlas-model";
import { countyAhead, stateAtPoint, type CountyQuestion } from "@/lib/next-county";
import { triviaFor } from "@/lib/state-facts";
import { heading, speedMph } from "@/lib/motion";
import { announce } from "@/lib/voice";
import type { MyGames } from "@/lib/boards";

type Fix = { lat: number; lon: number };
type Games = MyGames;
type Question = { kind: "county" | "trivia"; key: string; q: string; answer: string; choices: string[]; at: number };

const MISS_AFTER = 120_000;

export function useDriveGames({ driving, fix, states }: { driving: boolean; fix: Fix | null; states: StateInfo[] | null }) {
  const [games, setGames] = useState<Games | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [result, setResult] = useState<{ right: boolean; answer: string } | null>(null);
  const stateWas = useRef<string | null>(null);
  const stateAt = useRef<{ lat: number; lon: number; t: number } | null>(null);
  const countyAt = useRef<{ lat: number; lon: number; t: number } | null>(null);
  const asked = useRef(new Set<string>());

  // Which games you have: on entering Drive mode, then every 10 minutes.
  useEffect(() => {
    if (!driving) {
      setQuestion(null);
      stateWas.current = null;
      return;
    }
    let live = true;
    // Off screen nothing is asked, so nothing is checked either (it looks again on coming back).
    const load = () =>
      document.visibilityState !== "visible"
        ? undefined
        : import("@/lib/boards")
        .then((mod) => mod.myGames())
        .then((next) => live && setGames(next))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 600_000);
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [driving]);

  const any = !!games && (games.county || games.trivia || games.guess.length > 0);

  // Crossing into a state: settle the guess, ask a trivia question.
  useEffect(() => {
    if (!driving || !any || !fix || !states) return;
    const prev = stateAt.current;
    if (prev && Date.now() - prev.t < 30_000 && Math.hypot((fix.lon - prev.lon) * 53, (fix.lat - prev.lat) * 69) < 0.4) return;
    stateAt.current = { lat: fix.lat, lon: fix.lon, t: Date.now() };
    void stateAtPoint(fix.lat, fix.lon, states).then(async (state) => {
      if (!state) return;
      const was = stateWas.current;
      stateWas.current = state;
      if (games?.guess.length && games.guess.some((round) => round.from && round.from !== state)) {
        try {
          const { settleStateLine } = await import("@/lib/boards");
          const { settled } = await settleStateLine({ data: { state } });
          if (settled.length) {
            announce(`State line! That settles the round on ${settled[0]}.`, "highlights", true);
            setGames((cur) => (cur ? { ...cur, guess: cur.guess.filter((round) => round.from === state) } : cur));
          }
        } catch {
          // Next fix.
        }
      }
      if (was && was !== state && games?.trivia && document.visibilityState === "visible") {
        const t = triviaFor(state);
        if (!t) return;
        setResult(null);
        setQuestion({ kind: "trivia", key: `t:${state}:${Date.now()}`, q: t.q, answer: t.answer, choices: t.choices, at: Date.now() });
        announce(`State trivia: ${t.q} ${t.choices.join(", or ")}?`, "highlights", true);
      }
    });
  }, [driving, any, fix, states, games]);

  // Name that county: look a mile and a half ahead every half mile.
  useEffect(() => {
    if (!driving || !games?.county || !fix || !states || question || document.visibilityState !== "visible") return;
    const going = heading();
    if (going == null || (speedMph() ?? 0) < 15) return;
    const prev = countyAt.current;
    if (prev && Date.now() - prev.t < 20_000 && Math.hypot((fix.lon - prev.lon) * 53, (fix.lat - prev.lat) * 69) < 0.5) return;
    countyAt.current = { lat: fix.lat, lon: fix.lon, t: Date.now() };
    void countyAhead(fix.lat, fix.lon, going, states).then((hit: CountyQuestion | null) => {
      if (!hit || asked.current.has(hit.id)) return;
      asked.current.add(hit.id);
      const q = `Which county is next?`;
      setResult(null);
      setQuestion({ kind: "county", key: `c:${hit.id}`, q, answer: hit.name, choices: hit.choices, at: Date.now() });
      announce(`Name that county: ${hit.choices.join(", or ")}?`, "highlights", true);
    });
  }, [driving, games, fix, states, question]);

  // Not answered in two minutes: gone (and not counted).
  useEffect(() => {
    if (!question) return;
    const timer = window.setTimeout(() => setQuestion((cur) => (cur?.key === question.key ? null : cur)), MISS_AFTER);
    return () => window.clearTimeout(timer);
  }, [question]);

  // The result shows for a few seconds.
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [result]);

  function answer(choice: string) {
    if (!question) return;
    const right = choice === question.answer;
    setResult({ right, answer: question.answer });
    setQuestion(null);
    announce(right ? "Right!" : `It's ${question.answer}.`, "highlights", true);
    void import("@/lib/boards")
      .then((mod) => mod.addGameResult({ data: { kind: question.kind, right, q: question.kind === "county" ? question.answer : question.q } }))
      .catch(() => undefined);
  }

  return { question, result, answer, dismiss: () => setQuestion(null) };
}

/** The question (or how it went), as a strip in the drive card. */
export function DriveQuiz({ question, result, answer, dismiss }: ReturnType<typeof useDriveGames>) {
  if (result) {
    return (
      <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
        {result.right ? <Check className="size-5 shrink-0" aria-hidden /> : <X className="size-5 shrink-0 text-muted" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-[15px]">{result.right ? `Right: ${result.answer}` : `It was ${result.answer}`}</span>
      </div>
    );
  }
  if (!question) return null;
  return (
    <div className="border-t border-line px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] tracking-widest text-faint uppercase">{question.kind === "county" ? "Name that county" : "State trivia"}</span>
        <button type="button" onClick={dismiss} className="ml-auto text-xs text-faint">
          Skip
        </button>
      </div>
      <p className="mt-0.5 text-[15px] leading-snug">{question.q}</p>
      <div className="mt-2 grid gap-1.5">
        {question.choices.map((choice) => (
          <button key={choice} type="button" onClick={() => answer(choice)} className="min-h-11 rounded-lg border border-line px-3 py-1.5 text-left text-[15px] active:bg-elevated">
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}
