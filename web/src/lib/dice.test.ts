import { describe, expect, it } from "vitest";
import { canRollWith, describeScore, scoreDice, toggleHold } from "./dice";

describe("scoreDice (must match BarDice.scoreDice)", () => {
  // Same table as contracts/test/BarDice.ts so web and chain agree.
  it.each([
    [[2, 3, 4, 5, 5], 25],
    [[5, 5, 1, 5, 5], 45],
    [[6, 6, 6, 6, 6], 56],
    [[1, 1, 1, 1, 1], 51],
    [[1, 2, 3, 4, 6], 16],
    [[3, 3, 5, 5, 1], 25],
    [[2, 2, 2, 6, 6], 32],
    [[4, 1, 4, 1, 4], 34],
  ])("%j scores %i", (dice, score) => {
    expect(scoreDice(dice)).toBe(score);
  });

  it("rejects impossible dice", () => {
    expect(() => scoreDice([0, 1, 2, 3, 4])).toThrow(RangeError);
    expect(() => scoreDice([7, 1, 2, 3, 4])).toThrow(RangeError);
  });

  it("every possible roll produces a valid two-digit score", () => {
    for (let n = 0; n < 6 ** 5; n++) {
      const dice = [0, 1, 2, 3, 4].map((i) => (Math.floor(n / 6 ** i) % 6) + 1);
      const s = scoreDice(dice);
      const count = Math.floor(s / 10);
      const face = s % 10;
      expect(dice.filter((d) => d === face)).toHaveLength(count);
    }
  });
});

describe("farming", () => {
  it("cannot release a die that was already farmed", () => {
    expect(toggleHold(0b00001, 0b00001, 0)).toBe(0b00001);
    expect(toggleHold(0b00001, 0b00001, 2)).toBe(0b00101);
    expect(toggleHold(0b00101, 0b00001, 2)).toBe(0b00001);
  });

  it("rolling requires keeping farmed dice and leaving one to roll", () => {
    expect(canRollWith(0b00011, 0b00001)).toBe(true);
    expect(canRollWith(0b00010, 0b00001)).toBe(false);
    expect(canRollWith(0b11111, 0)).toBe(false);
  });
});

describe("describeScore", () => {
  it("reads like a bartender", () => {
    expect(describeScore(45)).toBe("four 5s");
    expect(describeScore(16)).toBe("high die 6");
  });
});
