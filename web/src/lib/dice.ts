export type Dice = readonly [number, number, number, number, number];

export const NUM_DICE = 5;
export const MAX_ROLLS = 3;
export const ALL_HELD = 0b11111;

/** Mirror of BarDice.scoreDice: tens = how many match, ones = which face. */
export function scoreDice(dice: readonly number[]): number {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) {
    if (!Number.isInteger(d) || d < 1 || d > 6) throw new RangeError(`invalid die ${d}`);
    counts[d]! += 1;
  }
  let bestCount = 0;
  let bestFace = 0;
  for (let face = 6; face >= 1; face--) {
    if (counts[face]! > bestCount) {
      bestCount = counts[face]!;
      bestFace = face;
    }
  }
  return bestCount * 10 + bestFace;
}

export function describeScore(score: number): string {
  const count = Math.floor(score / 10);
  const face = score % 10;
  const names = ["", "one", "two", "three", "four", "five"] as const;
  if (count <= 1) return `high die ${face}`;
  return `${names[count]} ${face}s`;
}

export const isHeld = (mask: number, i: number) => ((mask >> i) & 1) === 1;

/** Toggle die `i` in the next-hold selection, but never release a die that was already farmed. */
export function toggleHold(selection: number, lockedMask: number, i: number): number {
  if (isHeld(lockedMask, i)) return selection;
  return selection ^ (1 << i);
}

export function canRollWith(mask: number, lockedMask: number): boolean {
  return mask >= 0 && mask < ALL_HELD && (mask & lockedMask) === lockedMask;
}
