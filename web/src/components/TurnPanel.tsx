import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { canRollWith, describeScore, isHeld, MAX_ROLLS, scoreDice, toggleHold } from "../lib/dice";
import { TurnStatus, type useBarAction, type useGame } from "../lib/useBarDice";
import { Die } from "./Die";

type Props = { game: ReturnType<typeof useGame>; action: ReturnType<typeof useBarAction>; now?: number };

const VRF_TIMEOUT_S = 24 * 3600;
const TURN_DURATION_S = 600;

export function TurnPanel({ game, action, now }: Props) {
  const { turn, entryFee, playedToday, paused, day } = game;
  const [selection, setSelection] = useState(0);
  const locked = turn?.heldMask ?? 0;

  // Start each new roll with exactly the dice that are already farmed selected.
  useEffect(() => setSelection(locked), [locked, turn?.rolls]);

  // A turn started just before midnight is still yours to finish the next day.
  const active = turn?.status === TurnStatus.Active;
  const finishedToday = turn?.status === TurnStatus.Finished && turn.day === day;
  const showTurn = active || finishedToday;
  const dice = (showTurn && turn ? turn.dice : [0, 0, 0, 0, 0]).map(Number);
  const rolled = dice.every((d) => d > 0);
  const nowS = now ?? Math.floor(Date.now() / 1000);
  const expired = active && nowS > Number(turn.startedAt) + TURN_DURATION_S;
  const refundable =
    turn?.status === TurnStatus.Active && turn.rolls === 0 && nowS >= Number(turn.startedAt) + VRF_TIMEOUT_S;

  const canFarm = active && !turn.pending && turn.rolls > 0 && turn.rolls < MAX_ROLLS && !expired;

  return (
    <section className="rounded-3xl bg-stone-900/70 p-6 shadow-xl ring-1 ring-stone-700" aria-labelledby="turn-heading">
      <h2 id="turn-heading" className="mb-4 text-xl font-semibold text-amber-200">Your shake</h2>

      <div className="flex flex-wrap justify-center gap-3" data-testid="dice">
        {dice.map((v, i) => (
          <Die
            key={i}
            index={i}
            value={v}
            held={showTurn && isHeld(canFarm ? selection : locked, i)}
            locked={showTurn && isHeld(locked, i)}
            rolling={Boolean(active && turn?.pending && !isHeld(locked, i))}
            onToggle={canFarm ? () => setSelection((s) => toggleHold(s, locked, i)) : undefined}
          />
        ))}
      </div>

      <p className="mt-4 text-center text-stone-300" data-testid="turn-status" aria-live="polite">
        {!turn || (!active && !finishedToday)
          ? playedToday
            ? "You've had your shake today."
            : "Grab the cup — one shake per day."
          : active && turn.pending
            ? "Shaking… waiting on Chainlink VRF for fair dice."
            : finishedToday
              ? `Final score ${scoreDice(dice)} (${describeScore(scoreDice(dice))}).`
              : rolled
                ? `Roll ${turn.rolls} of ${MAX_ROLLS} — showing ${scoreDice(dice)} (${describeScore(scoreDice(dice))}). Tap dice to farm them.`
                : ""}
      </p>

      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {!active && !playedToday && entryFee !== undefined && (
          <button
            className="btn-primary"
            disabled={action.busy !== null || paused}
            onClick={() => action.send("enter", [], entryFee)}
          >
            {action.busy === "enter" ? "Shaking…" : `Shake the cup (${formatEther(entryFee)} ETH)`}
          </button>
        )}
        {canFarm && (
          <button
            className="btn-primary"
            disabled={action.busy !== null || !canRollWith(selection, locked)}
            onClick={() => action.send("roll", [selection])}
          >
            {action.busy === "roll" ? "Rolling…" : `Roll ${5 - popcount(selection)} dice`}
          </button>
        )}
        {active && !turn.pending && turn.rolls > 0 && (
          <button className="btn-secondary" disabled={action.busy !== null} onClick={() => action.send("stand")}>
            {action.busy === "stand" ? "Locking in…" : "Stand — lock in my score"}
          </button>
        )}
        {refundable && (
          <button className="btn-secondary" disabled={action.busy !== null} onClick={() => action.send("refund")}>
            Refund (VRF never answered)
          </button>
        )}
      </div>
      {paused && <p className="mt-3 text-center text-sm text-amber-300">New games are paused.</p>}
    </section>
  );
}

function popcount(n: number) {
  let c = 0;
  for (let x = n; x; x &= x - 1) c++;
  return c;
}
