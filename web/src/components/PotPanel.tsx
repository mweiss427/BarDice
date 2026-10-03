import { formatEther } from "viem";
import { describeScore } from "../lib/dice";
import type { useGame } from "../lib/useBarDice";

export function PotPanel({ game, now }: { game: ReturnType<typeof useGame>; now: number }) {
  const { pot, today, dayEnd } = game;

  const tonight = pot !== undefined && today ? (pot + today.entries) / 2n : undefined;
  const left = dayEnd ? Math.max(0, Number(dayEnd) - now) : undefined;

  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="Today at the bar">
      <Stat label="Tonight's prize pool" value={tonight !== undefined ? `${formatEther(tonight)} ETH` : "—"} testId="prize" />
      <Stat label="Shakes today" value={today ? String(today.players) : "—"} />
      <Stat
        label="Score to beat"
        value={today && today.topScore > 0 ? `${today.topScore} · ${describeScore(today.topScore)}` : "No scores yet"}
        testId="top-score"
      />
      <Stat label="Bar closes in" value={left !== undefined ? fmt(left) : "—"} />
    </section>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-2xl bg-stone-900/60 p-4 ring-1 ring-stone-700">
      <div className="text-xs uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-stone-100" data-testid={testId}>{value}</div>
    </div>
  );
}

function fmt(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
