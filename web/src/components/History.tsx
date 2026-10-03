import { useQuery } from "@tanstack/react-query";
import { formatEther, type Address } from "viem";
import { useConnection, usePublicClient } from "wagmi";
import { appConfig } from "../config";
import { barDiceAbi } from "../generated/barDiceAbi";
import { describeScore } from "../lib/dice";
import type { useBarAction } from "../lib/useBarDice";

const bar = { address: appConfig.barDiceAddress!, abi: barDiceAbi } as const;

type Row = {
  day: bigint;
  score: number;
  topScore: number;
  settled: boolean;
  settleableAt: bigint;
  prize: bigint;
  claimed: boolean;
  claimDeadline: bigint;
};

export function MyDays({ action, block, now }: { action: ReturnType<typeof useBarAction>; block?: bigint; now: number }) {
  const client = usePublicClient();
  const { address } = useConnection();

  const { data: rows } = useQuery({
    queryKey: ["my-days", address, block?.toString()],
    enabled: Boolean(client && address),
    queryFn: async (): Promise<Row[]> => {
      const logs = await client!.getContractEvents({
        ...bar,
        eventName: "TurnFinished",
        args: { player: address as Address },
        fromBlock: appConfig.deployBlock,
      });
      return Promise.all(
        logs.reverse().slice(0, 14).map(async (log) => {
          const day = log.args.day!;
          const [d, claimed, settleableAt] = await Promise.all([
            client!.readContract({ ...bar, functionName: "getDay", args: [day] }),
            client!.readContract({ ...bar, functionName: "hasClaimed", args: [day, address as Address] }),
            client!.readContract({ ...bar, functionName: "settleableAt", args: [day] }),
          ]);
          return {
            day,
            score: log.args.score!,
            topScore: d.topScore,
            settled: d.settled,
            settleableAt,
            prize: d.prizePerWinner,
            claimed,
            claimDeadline: d.settledAt + 30n * 86_400n,
          };
        }),
      );
    },
  });

  if (!address) return null;
  return (
    <section className="rounded-3xl bg-stone-900/70 p-6 ring-1 ring-stone-700" aria-labelledby="mydays-heading">
      <h2 id="mydays-heading" className="mb-3 text-xl font-semibold text-amber-200">Your nights out</h2>
      {!rows?.length && <p className="text-stone-400">No finished shakes yet.</p>}
      <ul className="divide-y divide-stone-800">
        {rows?.map((r) => {
          const nowS = BigInt(now);
          const winning = r.score === r.topScore;
          return (
            <li key={r.day.toString()} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`day-${r.day}`}>
              <span className="text-stone-200">
                {dayLabel(r.day)} — scored <b>{r.score}</b> <span className="text-stone-400">({describeScore(r.score)})</span>
              </span>
              {!r.settled ? (
                nowS >= r.settleableAt && winning ? (
                  <button className="btn-primary" disabled={action.busy !== null} onClick={() => action.send("claim", [r.day])}>
                    Settle & claim
                  </button>
                ) : (
                  <span className="text-sm text-stone-400">{winning ? "Leading — results after closing" : `Top score ${r.topScore}`}</span>
                )
              ) : winning ? (
                r.claimed ? (
                  <span className="text-sm text-emerald-400">Won {formatEther(r.prize)} ETH ✓</span>
                ) : nowS <= r.claimDeadline ? (
                  <button className="btn-primary" disabled={action.busy !== null} onClick={() => action.send("claim", [r.day])}>
                    Claim {formatEther(r.prize)} ETH
                  </button>
                ) : (
                  <span className="text-sm text-amber-300">Unclaimed — went to charity</span>
                )
              ) : (
                <span className="text-sm text-stone-400">Winning score {r.topScore}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WallOfFame({ block }: { block?: bigint }) {
  const client = usePublicClient();
  const { data } = useQuery({
    queryKey: ["wall-of-fame", block?.toString()],
    enabled: Boolean(client),
    queryFn: async () => {
      const settled = await client!.getContractEvents({ ...bar, eventName: "DaySettled", fromBlock: appConfig.deployBlock });
      return Promise.all(
        settled.reverse().slice(0, 10).map(async (s) => {
          const finished = await client!.getContractEvents({
            ...bar,
            eventName: "TurnFinished",
            args: { day: s.args.day },
            fromBlock: appConfig.deployBlock,
          });
          const winners = finished.filter((f) => f.args.score === s.args.topScore).map((f) => f.args.player!);
          return { day: s.args.day!, top: s.args.topScore!, prize: s.args.prizePerWinner!, charity: s.args.charityCut!, winners };
        }),
      );
    },
  });

  return (
    <section className="rounded-3xl bg-stone-900/70 p-6 ring-1 ring-stone-700" aria-labelledby="fame-heading">
      <h2 id="fame-heading" className="mb-3 text-xl font-semibold text-amber-200">Wall of fame</h2>
      {!data?.length && <p className="text-stone-400">No nights settled yet.</p>}
      <ul className="space-y-2">
        {data?.map((d) => (
          <li key={d.day.toString()} className="text-stone-200">
            <span className="text-stone-400">{dayLabel(d.day)}</span> · {d.top} ({describeScore(d.top)}) ·{" "}
            {d.winners.length ? d.winners.map(short).join(", ") : "no winner"} · {formatEther(d.prize)} ETH each ·{" "}
            <span className="text-emerald-400">{formatEther(d.charity)} ETH to charity</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const dayLabel = (day: bigint) =>
  new Date(Number(day) * 86_400_000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
