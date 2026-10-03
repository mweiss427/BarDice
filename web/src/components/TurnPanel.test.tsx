import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseEther } from "viem";
import { describe, expect, it, vi } from "vitest";
import { TurnPanel } from "./TurnPanel";

const now = () => BigInt(Math.floor(Date.now() / 1000));

function setup(turn: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) {
  const send = vi.fn();
  const game = {
    day: 100n,
    entryFee: parseEther("0.1"),
    paused: false,
    playedToday: false,
    turn: turn && {
      requestId: 1n,
      day: 100n,
      startedAt: now(),
      rolls: 1,
      heldMask: 0,
      pending: false,
      status: 1,
      dice: [5, 2, 5, 3, 4],
      ...turn,
    },
    ...extra,
  };
  const action = { send, busy: null, error: null, clearError: () => {} };
  render(<TurnPanel game={game as never} action={action as never} />);
  return send;
}

describe("<TurnPanel>", () => {
  it("offers to enter for the on-chain entry fee", async () => {
    const send = setup(undefined);
    await userEvent.click(screen.getByRole("button", { name: /Shake the cup \(0.1 ETH\)/ }));
    expect(send).toHaveBeenCalledWith("enter", [], parseEther("0.1"));
  });

  it("farms the selected dice and rolls the rest", async () => {
    const send = setup({});
    expect(screen.getByTestId("turn-status")).toHaveTextContent("Roll 1 of 3 — showing 25 (two 5s)");
    await userEvent.click(screen.getByRole("button", { name: "Die 1: 5" }));
    await userEvent.click(screen.getByRole("button", { name: "Die 3: 5" }));
    await userEvent.click(screen.getByRole("button", { name: "Roll 3 dice" }));
    expect(send).toHaveBeenCalledWith("roll", [0b00101]);
  });

  it("shows a fair-dice waiting state while VRF is pending", () => {
    setup({ pending: true, rolls: 0, dice: [0, 0, 0, 0, 0] });
    expect(screen.getByTestId("turn-status")).toHaveTextContent("waiting on Chainlink VRF");
    expect(screen.queryByRole("button", { name: /Roll/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stand/ })).not.toBeInTheDocument();
  });

  it("only allows standing after a timed-out turn", () => {
    setup({ startedAt: now() - 3600n });
    expect(screen.queryByRole("button", { name: /Roll/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stand/ })).toBeEnabled();
  });

  it("shows the final score after the turn", () => {
    setup({ status: 2, rolls: 3, dice: [6, 6, 6, 6, 1] }, { playedToday: true });
    expect(screen.getByTestId("turn-status")).toHaveTextContent("Final score 46 (four 6s)");
    expect(screen.queryByRole("button", { name: /Shake/ })).not.toBeInTheDocument();
  });

  it("clears yesterday's dice when a new day starts", () => {
    setup({ status: 2, day: 99n, rolls: 3, dice: [6, 6, 6, 6, 1], heldMask: 0b01111 });
    expect(screen.getByRole("button", { name: "Die 1: not rolled" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Shake the cup/ })).toBeEnabled();
  });

  it("blocks entry while paused", () => {
    setup(undefined, { paused: true });
    expect(screen.getByRole("button", { name: /Shake the cup/ })).toBeDisabled();
  });
});
