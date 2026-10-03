import { BaseError, ContractFunctionRevertedError, encodeErrorResult, UserRejectedRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { barDiceAbi } from "../generated/barDiceAbi";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("turns contract reverts into plain English", () => {
    const data = encodeErrorResult({ abi: barDiceAbi, errorName: "AlreadyPlayedToday" });
    const revert = new ContractFunctionRevertedError({ abi: barDiceAbi, functionName: "enter", data });
    expect(friendlyError(new BaseError("simulate failed", { cause: revert }))).toBe(
      "You already played today — come back tomorrow!",
    );
  });

  it("falls back to the raw error name for unmapped reverts", () => {
    const data = encodeErrorResult({ abi: barDiceAbi, errorName: "NothingToWithdraw" });
    const revert = new ContractFunctionRevertedError({ abi: barDiceAbi, functionName: "withdrawCharity", data });
    expect(friendlyError(new BaseError("x", { cause: revert }))).toBe("NothingToWithdraw");
  });

  it("recognises a cancelled wallet prompt", () => {
    const err = new BaseError("wrap", { cause: new UserRejectedRequestError(new Error("no")) });
    expect(friendlyError(err)).toBe("You cancelled the transaction.");
  });
});
