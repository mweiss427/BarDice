import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeAbiParameters, getAddress, keccak256, toHex, zeroAddress } from "viem";

import {
  CALLBACK_GAS,
  CLAIM_WINDOW,
  DAY_START_OFFSET,
  ENTRY_FEE,
  KEY_HASH,
  SUB_ID,
  TURN_DURATION,
  VRF_TIMEOUT,
  balanceOf,
  connect,
  deployGame,
  enterWith,
  fulfillDice,
  liabilities,
  pendingRequest,
  settleableAt,
  startOfNextDay,
  type Dice,
  type Game,
} from "../test-utils/helpers.js";

const conn = await connect();
const { viem, networkHelpers } = conn;
const { loadFixture, time } = networkHelpers;

async function freshGame() {
  return deployGame(conn);
}

async function gameAtDayStart() {
  const g = await deployGame(conn);
  const day = await startOfNextDay(conn);
  return { ...g, day };
}

async function assertSolvent(g: Game) {
  const owed = await liabilities(g);
  const bal = await balanceOf(g, g.bar.address);
  assert.ok(bal >= owed, `insolvent: balance ${bal} < liabilities ${owed}`);
}

async function playFullTurn(g: Game, who: Game["alice"], dice: Dice) {
  await enterWith(g, who, dice);
  await g.bar.write.stand({ account: who.account });
}

describe("BarDice", () => {
  describe("deployment", () => {
    it("stores immutable configuration", async () => {
      const g = await loadFixture(freshGame);
      assert.equal(await g.bar.read.ENTRY_FEE(), ENTRY_FEE);
      assert.equal(await g.bar.read.CHARITY(), getAddress(g.charity.account.address));
      assert.equal(await g.bar.read.VRF_COORDINATOR(), getAddress(g.vrf.address));
      assert.equal(await g.bar.read.VRF_KEY_HASH(), KEY_HASH);
      assert.equal(await g.bar.read.VRF_SUBSCRIPTION_ID(), SUB_ID);
      assert.equal(await g.bar.read.DAY_START_OFFSET(), DAY_START_OFFSET);
      assert.equal(await g.bar.read.owner(), getAddress(g.owner.account.address));
    });

    it("rejects a zero charity or coordinator and silly config", async () => {
      const [owner, , , , charity] = await viem.getWalletClients();
      const vrf = { coordinator: zeroAddress, keyHash: KEY_HASH, subscriptionId: 1n, requestConfirmations: 3, callbackGasLimit: CALLBACK_GAS, nativePayment: false };
      const mock = await viem.deployContract("MockVRFCoordinator");
      await assert.rejects(viem.deployContract("BarDice", [owner.account.address, ENTRY_FEE, charity.account.address, 0n, vrf]));
      await assert.rejects(viem.deployContract("BarDice", [owner.account.address, ENTRY_FEE, zeroAddress, 0n, { ...vrf, coordinator: mock.address }]));
      await assert.rejects(viem.deployContract("BarDice", [owner.account.address, 0n, charity.account.address, 0n, { ...vrf, coordinator: mock.address }]));
      await assert.rejects(viem.deployContract("BarDice", [owner.account.address, ENTRY_FEE, charity.account.address, 86_400n, { ...vrf, coordinator: mock.address }]));
      await assert.rejects(viem.deployContract("BarDice", [owner.account.address, ENTRY_FEE, charity.account.address, 0n, { ...vrf, coordinator: mock.address, callbackGasLimit: 50_000 }]));
    });

    it("exposes no way for the owner to move funds or change randomness", async () => {
      const g = await loadFixture(freshGame);
      const names = g.bar.abi.filter((x) => x.type === "function").map((x) => x.name);
      for (const forbidden of ["withdraw", "setCoordinator", "setEntryFee", "setCharity", "sweep", "rescue", "emergencyWithdraw"]) {
        assert.ok(!names.includes(forbidden as never), `unexpected admin function ${forbidden}`);
      }
      // The only owner-gated actions are pause/unpause and ownership transfer.
      const ownerOnly = ["pause", "unpause", "transferOwnership", "renounceOwnership"];
      for (const fn of ownerOnly) assert.ok(names.includes(fn as never));
    });
  });

  describe("entering", () => {
    it("requires the exact entry fee", async () => {
      const g = await loadFixture(gameAtDayStart);
      await viem.assertions.revertWithCustomErrorWithArgs(
        g.bar.write.enter({ value: ENTRY_FEE - 1n, account: g.alice.account }),
        g.bar,
        "WrongEntryFee",
        [ENTRY_FEE - 1n, ENTRY_FEE],
      );
      await viem.assertions.revertWithCustomError(
        g.bar.write.enter({ value: ENTRY_FEE + 1n, account: g.alice.account }),
        g.bar,
        "WrongEntryFee",
      );
    });

    it("requests VRF with the configured key hash, subscription and gas limit", async () => {
      const g = await loadFixture(gameAtDayStart);
      await viem.assertions.emit(g.bar.write.enter({ value: ENTRY_FEE, account: g.alice.account }), g.bar, "Entered");
      const [keyHash, subId, confirmations, gas, numWords, extraArgs] = await g.vrf.read.lastRequest();
      assert.equal(keyHash, KEY_HASH);
      assert.equal(subId, SUB_ID);
      assert.equal(confirmations, 3);
      assert.equal(gas, CALLBACK_GAS);
      assert.equal(numWords, 1);
      const tag = keccak256(toHex("VRF ExtraArgsV1")).slice(0, 10);
      assert.equal(extraArgs.slice(0, 10), tag);
      const [nativePayment] = decodeAbiParameters([{ type: "bool" }], `0x${extraArgs.slice(10)}`);
      assert.equal(nativePayment, false);
      assert.equal(await g.bar.read.escrow(), ENTRY_FEE);
    });

    it("allows one entry per address per bar day", async () => {
      const g = await loadFixture(gameAtDayStart);
      await playFullTurn(g, g.alice, [1, 2, 3, 4, 5]);
      await viem.assertions.revertWithCustomError(
        g.bar.write.enter({ value: ENTRY_FEE, account: g.alice.account }),
        g.bar,
        "AlreadyPlayedToday",
      );
      await startOfNextDay(conn);
      await playFullTurn(g, g.alice, [1, 2, 3, 4, 5]);
    });

    it("lets many players play at the same time (no global lock)", async () => {
      const g = await loadFixture(gameAtDayStart);
      await g.bar.write.enter({ value: ENTRY_FEE, account: g.alice.account });
      await g.bar.write.enter({ value: ENTRY_FEE, account: g.bob.account });
      await g.bar.write.enter({ value: ENTRY_FEE, account: g.carol.account });
      await fulfillDice(g, g.bob.account.address, [6, 6, 1, 2, 3]);
      await fulfillDice(g, g.alice.account.address, [1, 1, 1, 2, 3]);
      await fulfillDice(g, g.carol.account.address, [4, 4, 4, 4, 2]);
      assert.deepEqual((await g.bar.read.getTurn([g.bob.account.address])).dice, [6, 6, 1, 2, 3]);
      assert.deepEqual((await g.bar.read.getTurn([g.alice.account.address])).dice, [1, 1, 1, 2, 3]);
    });

    it("an abandoned turn never blocks anyone else", async () => {
      const g = await loadFixture(gameAtDayStart);
      await g.bar.write.enter({ value: ENTRY_FEE, account: g.alice.account }); // never fulfilled, never finished
      await time.increase(3_600);
      await playFullTurn(g, g.bob, [2, 2, 2, 3, 4]);
    });

    it("pausing stops new entries but nothing else", async () => {
      const g = await loadFixture(gameAtDayStart);
      await enterWith(g, g.alice, [6, 6, 6, 1, 2]);
      await g.bar.write.pause({ account: g.owner.account });
      await viem.assertions.revertWithCustomError(
        g.bar.write.enter({ value: ENTRY_FEE, account: g.bob.account }),
        g.bar,
        "EnforcedPause",
      );
      await g.bar.write.stand({ account: g.alice.account });
      await time.increaseTo(await settleableAt(g, g.day));
      await g.bar.write.claim([g.day], { account: g.alice.account });
    });

    it("the owner can unpause, and ownership transfer is two-step", async () => {
      const g = await loadFixture(gameAtDayStart);
      await g.bar.write.pause({ account: g.owner.account });
      await g.bar.write.unpause({ account: g.owner.account });
      await enterWith(g, g.alice, [1, 2, 3, 4, 5]);
      await g.bar.write.transferOwnership([g.bob.account.address], { account: g.owner.account });
      assert.equal(await g.bar.read.owner(), getAddress(g.owner.account.address)); // not yet
      await g.bar.write.acceptOwnership({ account: g.bob.account });
      assert.equal(await g.bar.read.owner(), getAddress(g.bob.account.address));
    });

    it("only the owner can pause", async () => {
      const g = await loadFixture(freshGame);
      await viem.assertions.revertWithCustomError(
        g.bar.write.pause({ account: g.stranger.account }),
        g.bar,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("rolling and farming", () => {
    it("only the VRF coordinator can deliver randomness", async () => {
      const g = await loadFixture(gameAtDayStart);
      await g.bar.write.enter({ value: ENTRY_FEE, account: g.alice.account });
      const id = await pendingRequest(g, g.alice.account.address);
      await viem.assertions.revertWithCustomError(
        g.bar.write.rawFulfillRandomWords([id, [0n]], { account: g.alice.account }),
        g.bar,
        "OnlyCoordinator",
      );
    });

    it("cannot roll again while a roll is pending", async () => {
      const g = await loadFixture(gameAtDayStart);
      await g.bar.write.enter({ value: ENTRY_FEE, account: g.alice.account });
      await viem.assertions.revertWithCustomError(g.bar.write.roll([0], { account: g.alice.account }), g.bar, "RollPending");
      await viem.assertions.revertWithCustomError(g.bar.write.stand({ account: g.alice.account }), g.bar, "RollPending");
    });

    it("held dice never change and un-held dice are re-rolled", async () => {
      const g = await loadFixture(gameAtDayStart);
      await enterWith(g, g.alice, [5, 2, 5, 3, 4]);
      await g.bar.write.roll([0b00101], { account: g.alice.account }); // farm the two 5s
      // VRF tries to set every die to 1 — held dice must ignore it.
      await fulfillDice(g, g.alice.account.address, [1, 1, 1, 1, 1]);
      assert.deepEqual((await g.bar.read.getTurn([g.alice.account.address])).dice, [5, 1, 5, 1, 1]);
    });

    it("farming is one-way and you cannot hold all five", async () => {
      const g = await loadFixture(gameAtDayStart);
      await enterWith(g, g.alice, [5, 2, 5, 3, 4]);
      await g.bar.write.roll([0b00101], { account: g.alice.account });
      await fulfillDice(g, g.alice.account.address, [5, 5, 5, 5, 5]);
      await viem.assertions.revertWithCustomError(g.bar.write.roll([0b00001], { account: g.alice.account }), g.bar, "InvalidHold");
      await viem.assertions.revertWithCustomError(g.bar.write.roll([0b11111], { account: g.alice.account }), g.bar, "InvalidHold");
      await viem.assertions.revertWithCustomError(g.bar.write.roll([0b100000], { account: g.alice.account }), g.bar, "InvalidHold");
    });

    it("the third roll ends the turn and records the score", async () => {
      const g = await loadFixture(gameAtDayStart);
      await enterWith(g, g.alice, [5, 2, 5, 3, 4]);
      await g.bar.write.roll([0b00101], { account: g.alice.account });
      await fulfillDice(g, g.alice.account.address, [1, 5, 1, 1, 1]);
      await g.bar.write.roll([0b00111], { account: g.alice.account });
      await fulfillDice(g, g.alice.account.address, [1, 1, 1, 5, 5]);
      const turn = await g.bar.read.getTurn([g.alice.account.address]);
      assert.equal(turn.status, 2); // Finished
      assert.equal(turn.rolls, 3);
      assert.equal(await g.bar.read.scoreOf([g.day, g.alice.account.address]), 55);
      await viem.assertions.revertWithCustomError(g.bar.write.roll([0b00111], { account: g.alice.account }), g.bar, "NoActiveTurn");
    });

    it("turns expire after TURN_DURATION", async () => {
      const g = await loadFixture(gameAtDayStart);
      await enterWith(g, g.alice, [5, 2, 5, 3, 4]);
      await time.increase(TURN_DURATION + 1n);
      await viem.assertions.revertWithCustomError(g.bar.write.roll([0], { account: g.alice.account }), g.bar, "TurnExpired");
      // ...but the player can still lock in what they have.
      await g.bar.write.stand({ account: g.alice.account });
      assert.equal(await g.bar.read.scoreOf([g.day, g.alice.account.address]), 25);
    });
  });

  describe("scoring", () => {
    const cases: Array<[Dice, number]> = [
      [[2, 3, 4, 5, 5], 25], // README example
      [[5, 5, 1, 5, 5], 45], // README example after farming
      [[6, 6, 6, 6, 6], 56], // best possible
      [[1, 1, 1, 1, 1], 51],
      [[1, 2, 3, 4, 6], 16], // nothing matches: highest single die
      [[3, 3, 5, 5, 1], 25], // two pairs: higher face wins
      [[2, 2, 2, 6, 6], 32], // more dice beats higher face
      [[4, 1, 4, 1, 4], 34],
    ];
    for (const [dice, score] of cases) {
      it(`scores ${dice.join(",")} as ${score}`, async () => {
        const g = await loadFixture(freshGame);
        assert.equal(await g.bar.read.scoreDice([dice]), score);
      });
    }
  });

  describe("settlement and payouts", () => {
    it("cannot settle a day until every turn could have finished", async () => {
      const g = await loadFixture(gameAtDayStart);
      await playFullTurn(g, g.alice, [6, 6, 1, 2, 3]);
      const at = await settleableAt(g, g.day);
      await time.increaseTo(at - 2n);
      await viem.assertions.revertWithCustomError(g.bar.write.settleDay([g.day]), g.bar, "DayNotOver");
      await time.increaseTo(at);
      await g.bar.write.settleDay([g.day]);
      await viem.assertions.revertWithCustomError(g.bar.write.settleDay([g.day]), g.bar, "DayAlreadySettled");
    });

    it("pays 50% of the pot: 95% to the winner, 5% to charity, rest rolls over", async () => {
      const g = await loadFixture(gameAtDayStart);
      await playFullTurn(g, g.alice, [6, 6, 6, 1, 2]); // 36
      await playFullTurn(g, g.bob, [2, 2, 3, 4, 5]); // 22
      await playFullTurn(g, g.carol, [5, 5, 5, 1, 2]); // 35
      await time.increaseTo(await settleableAt(g, g.day));
      await g.bar.write.settleDay([g.day]);

      const total = 3n * ENTRY_FEE;
      const prizePool = total / 2n;
      const charityCut = (prizePool * 500n) / 10_000n;
      const winnerPrize = prizePool - charityCut;
      const d = await g.bar.read.getDay([g.day]);
      assert.equal(d.topScore, 36);
      assert.equal(d.winners, 1);
      assert.equal(d.prizePerWinner, winnerPrize);
      assert.equal(await g.bar.read.charityBalance(), charityCut);
      assert.equal(await g.bar.read.pot(), total - prizePool);

      await viem.assertions.balancesHaveChanged(g.bar.write.claim([g.day], { account: g.alice.account }), [
        { address: g.alice.account.address, amount: winnerPrize },
      ]);
      await viem.assertions.revertWithCustomError(g.bar.write.claim([g.day], { account: g.alice.account }), g.bar, "AlreadyClaimed");
      await viem.assertions.revertWithCustomError(g.bar.write.claim([g.day], { account: g.carol.account }), g.bar, "NotAWinner");
      await viem.assertions.revertWithCustomError(g.bar.write.claim([g.day], { account: g.stranger.account }), g.bar, "NotAWinner");
      await assertSolvent(g);
    });

    it("splits the prize between tied winners", async () => {
      const g = await loadFixture(gameAtDayStart);
      await playFullTurn(g, g.alice, [4, 4, 4, 1, 2]);
      await playFullTurn(g, g.bob, [4, 4, 4, 6, 6]);
      await playFullTurn(g, g.carol, [3, 3, 3, 1, 2]);
      await time.increaseTo(await settleableAt(g, g.day));
      await g.bar.write.claim([g.day], { account: g.alice.account }); // auto-settles
      await g.bar.write.claim([g.day], { account: g.bob.account });
      const d = await g.bar.read.getDay([g.day]);
      assert.equal(d.winners, 2);
      assert.equal(d.claimed, 2);
      assert.equal(await g.bar.read.prizeLiability(), 0n);
      await assertSolvent(g);
    });

    it("the pot grows across days", async () => {
      const g = await loadFixture(gameAtDayStart);
      await playFullTurn(g, g.alice, [6, 6, 1, 2, 3]);
      await time.increaseTo(await settleableAt(g, g.day));
      await g.bar.write.settleDay([g.day]);
      const potAfterDay1 = await g.bar.read.pot();
      assert.equal(potAfterDay1, ENTRY_FEE / 2n);

      const day2 = await startOfNextDay(conn);
      await playFullTurn(g, g.bob, [6, 6, 1, 2, 3]);
      await time.increaseTo(await settleableAt(g, day2));
      await g.bar.write.settleDay([day2]);
      const prizePool = (potAfterDay1 + ENTRY_FEE) / 2n;
      assert.equal(await g.bar.read.pot(), potAfterDay1 + ENTRY_FEE - prizePool);
    });

    it("a day with entries but no finished turns rolls everything over", async () => {
      const g = await loadFixture(gameAtDayStart);
      await enterWith(g, g.alice, [1, 2, 3, 4, 5]); // never stands
      await time.increaseTo(await settleableAt(g, g.day));
      await g.bar.write.settleDay([g.day]);
      assert.equal(await g.bar.read.pot(), ENTRY_FEE);
      assert.equal(await g.bar.read.charityBalance(), 0n);
      await viem.assertions.revertWithCustomError(g.bar.write.stand({ account: g.alice.account }), g.bar, "DayAlreadySettled");
    });

    it("unclaimed prizes go to charity after 30 days", async () => {
      const g = await loadFixture(gameAtDayStart);
      await playFullTurn(g, g.alice, [6, 6, 1, 2, 3]);
      await time.increaseTo(await settleableAt(g, g.day));
      await g.bar.write.settleDay([g.day]);
      await viem.assertions.revertWithCustomError(g.bar.write.sweepUnclaimed([g.day]), g.bar, "ClaimWindowOpen");
      await time.increase(CLAIM_WINDOW + 1n);
      await viem.assertions.revertWithCustomError(g.bar.write.claim([g.day], { account: g.alice.account }), g.bar, "ClaimWindowClosed");

      const prize = (await g.bar.read.getDay([g.day])).prizePerWinner;
      const charityBefore = await g.bar.read.charityBalance();
      await g.bar.write.sweepUnclaimed([g.day], { account: g.stranger.account });
      assert.equal(await g.bar.read.charityBalance(), charityBefore + prize);
      await viem.assertions.revertWithCustomError(g.bar.write.sweepUnclaimed([g.day]), g.bar, "ClaimWindowClosed");

      // Anyone can push charity funds, but they only ever go to the charity address.
      const owed = await g.bar.read.charityBalance();
      await viem.assertions.balancesHaveChanged(g.bar.write.withdrawCharity({ account: g.stranger.account }), [
        { address: g.charity.account.address, amount: owed },
      ]);
      await viem.assertions.revertWithCustomError(g.bar.write.withdrawCharity(), g.bar, "NothingToWithdraw");
      await assertSolvent(g);
    });

    it("donations go into the pot", async () => {
      const g = await loadFixture(freshGame);
      await g.bar.write.donate({ value: 10n ** 18n, account: g.stranger.account });
      assert.equal(await g.bar.read.pot(), 10n ** 18n);
    });

    it("rejects plain ETH transfers (no accidental deposits)", async () => {
      const g = await loadFixture(freshGame);
      await assert.rejects(g.stranger.sendTransaction({ to: g.bar.address, value: 1n }));
    });
  });

  describe("VRF failure handling", () => {
    it("refunds the entry fee only after VRF_TIMEOUT if the first roll never arrives", async () => {
      const g = await loadFixture(gameAtDayStart);
      await g.bar.write.enter({ value: ENTRY_FEE, account: g.alice.account });
      const id = await pendingRequest(g, g.alice.account.address);
      await viem.assertions.revertWithCustomError(g.bar.write.refund({ account: g.alice.account }), g.bar, "NotRefundable");
      await time.increase(VRF_TIMEOUT);
      await viem.assertions.balancesHaveChanged(g.bar.write.refund({ account: g.alice.account }), [
        { address: g.alice.account.address, amount: ENTRY_FEE },
      ]);
      // A very late fulfilment after the refund changes nothing.
      await g.vrf.write.fulfillDice([id, [6, 6, 6, 6, 6]]);
      const turn = await g.bar.read.getTurn([g.alice.account.address]);
      assert.equal(turn.status, 3); // Refunded
      assert.equal(await g.bar.read.escrow(), 0n);
      await assertSolvent(g);
    });

    it("cannot refund once the first roll has landed", async () => {
      const g = await loadFixture(gameAtDayStart);
      await enterWith(g, g.alice, [1, 2, 3, 4, 5]);
      await time.increase(VRF_TIMEOUT);
      await viem.assertions.revertWithCustomError(g.bar.write.refund({ account: g.alice.account }), g.bar, "NotRefundable");
    });

    it("a first roll that lands after the day settled feeds the pot and cannot win", async () => {
      const g = await loadFixture(gameAtDayStart);
      await playFullTurn(g, g.bob, [2, 2, 1, 3, 4]);
      await g.bar.write.enter({ value: ENTRY_FEE, account: g.alice.account });
      await time.increaseTo(await settleableAt(g, g.day));
      await g.bar.write.settleDay([g.day]);
      const potBefore = await g.bar.read.pot();
      await fulfillDice(g, g.alice.account.address, [6, 6, 6, 6, 6]);
      assert.equal(await g.bar.read.pot(), potBefore + ENTRY_FEE);
      assert.equal(await g.bar.read.scoreOf([g.day, g.alice.account.address]), 0);
      assert.equal((await g.bar.read.getDay([g.day])).topScore, 22);
      await assertSolvent(g);
    });
  });

  describe("attacks", () => {
    it("a malicious winner contract cannot re-enter claim or refund", async () => {
      const g = await loadFixture(gameAtDayStart);
      const attacker = await viem.deployContract("AttackerPlayer", [g.bar.address]);
      await g.bar.write.donate({ value: 10n ** 19n }); // a juicy 10 ETH pot
      await attacker.write.enter({ value: ENTRY_FEE });
      await fulfillDice(g, attacker.address, [6, 6, 6, 6, 6]);
      await attacker.write.stand();
      await time.increaseTo(await settleableAt(g, g.day));

      const prize = await (async () => {
        await g.bar.write.settleDay([g.day]);
        return (await g.bar.read.getDay([g.day])).prizePerWinner;
      })();
      await attacker.write.claim([g.day]);
      assert.equal(await attacker.read.reentryAttempts(), 1n);
      assert.equal(await attacker.read.reentrySuccesses(), 0n);
      assert.equal(await balanceOf(g, attacker.address), prize);
      await assertSolvent(g);
    });

    it("the old exploit is gone: a player cannot predict or choose dice", async () => {
      // Dice depend only on the VRF word. The same player in the same block gets
      // different dice for different words, and nothing a player controls feeds in.
      const g = await loadFixture(gameAtDayStart);
      await enterWith(g, g.alice, [1, 1, 1, 1, 1]);
      await enterWith(g, g.bob, [6, 5, 4, 3, 2]);
      assert.deepEqual((await g.bar.read.getTurn([g.alice.account.address])).dice, [1, 1, 1, 1, 1]);
      assert.deepEqual((await g.bar.read.getTurn([g.bob.account.address])).dice, [6, 5, 4, 3, 2]);
    });
  });
});
