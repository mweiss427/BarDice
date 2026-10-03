import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useBlock, useConfig, useConnection, useReadContracts } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { appConfig } from "../config";
import { barDiceAbi } from "../generated/barDiceAbi";
import { friendlyError } from "./errors";

export const TurnStatus = { None: 0, Active: 1, Finished: 2, Refunded: 3 } as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** Re-fetch every contract read whenever a new block arrives, so the UI never shows stale dice. */
/** Also returns "now" by the chain's clock (the contract enforces deadlines on block time). */
export function useRefreshOnNewBlock() {
  const queryClient = useQueryClient();
  const { data: latest } = useBlock({ watch: true });
  const block = latest?.number ?? undefined;
  useEffect(() => {
    if (block !== undefined) void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "block" });
  }, [block, queryClient]);

  const [wall, setWall] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setWall(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const now = Math.max(wall, Number(latest?.timestamp ?? 0));
  return { block, now };
}

export function useGame() {
  const address = appConfig.barDiceAddress!;
  const { address: player } = useConnection();
  const bar = { address, abi: barDiceAbi } as const;

  const base = useReadContracts({
    contracts: [
      { ...bar, functionName: "currentDay" },
      { ...bar, functionName: "pot" },
      { ...bar, functionName: "ENTRY_FEE" },
      { ...bar, functionName: "paused" },
      { ...bar, functionName: "getTurn", args: [player ?? ZERO] },
    ],
    allowFailure: false,
  });
  const day = base.data?.[0];

  const dayReads = useReadContracts({
    contracts: [
      { ...bar, functionName: "getDay", args: [day ?? 0n] },
      { ...bar, functionName: "dayEnd", args: [day ?? 0n] },
      { ...bar, functionName: "hasPlayed", args: [day ?? 0n, player ?? ZERO] },
    ],
    allowFailure: false,
    query: { enabled: day !== undefined },
  });

  return {
    isLoading: base.isLoading || dayReads.isLoading,
    error: base.error ?? dayReads.error,
    day,
    pot: base.data?.[1],
    entryFee: base.data?.[2],
    paused: base.data?.[3],
    turn: player ? base.data?.[4] : undefined,
    today: dayReads.data?.[0],
    dayEnd: dayReads.data?.[1],
    playedToday: player ? dayReads.data?.[2] : undefined,
  };
}

type WriteFn = "enter" | "roll" | "stand" | "refund" | "settleDay" | "claim" | "withdrawCharity";

/** Simulate first (so reverts show a readable reason before the wallet pops up), then send and wait. */
export function useBarAction() {
  const config = useConfig();
  const { address: account } = useConnection();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<WriteFn | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (functionName: WriteFn, args: readonly unknown[] = [], value?: bigint) => {
      if (!account || !appConfig.barDiceAddress) return;
      setBusy(functionName);
      setError(null);
      try {
        const { request } = await simulateContract(config, {
          address: appConfig.barDiceAddress,
          abi: barDiceAbi,
          functionName,
          args,
          value,
          account,
          chainId: appConfig.chain.id,
        } as never);
        const hash = await writeContract(config, request);
        await waitForTransactionReceipt(config, { hash, chainId: appConfig.chain.id });
        await queryClient.invalidateQueries();
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(null);
      }
    },
    [account, config, queryClient],
  );

  return { send, busy, error, clearError: () => setError(null) };
}
