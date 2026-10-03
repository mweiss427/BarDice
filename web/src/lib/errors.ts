import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const FRIENDLY: Record<string, string> = {
  WrongEntryFee: "That's not the right entry fee.",
  AlreadyPlayedToday: "You already played today — come back tomorrow!",
  TurnInProgress: "Finish your current turn first.",
  NoActiveTurn: "You don't have a turn going.",
  RollPending: "Hang on — your dice are still in the air.",
  NoRollsLeft: "You're out of rolls.",
  MustRollFirst: "Roll first.",
  TurnExpired: "Your turn timed out. You can still stand with what you have.",
  InvalidHold: "You can't un-farm dice, and you must leave at least one to roll.",
  DayAlreadySettled: "That day is already closed.",
  DayNotOver: "That day can't be settled yet.",
  DayNotSettled: "That day hasn't been settled yet.",
  NotAWinner: "That prize isn't yours.",
  AlreadyClaimed: "Already claimed.",
  ClaimWindowClosed: "The 30-day claim window has closed.",
  NotRefundable: "Not refundable.",
  EnforcedPause: "New games are paused right now.",
};

export function friendlyError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled the transaction.";
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && FRIENDLY[name]) return FRIENDLY[name];
      if (name) return name;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}
