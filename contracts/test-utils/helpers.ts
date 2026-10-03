import { network } from "hardhat";
import { keccak256, parseEther, toHex } from "viem";

export const ENTRY_FEE = parseEther("0.1");
export const DAY = 86_400n;
export const DAY_START_OFFSET = 6n * 3600n; // midnight US Central (standard time)
export const KEY_HASH = keccak256(toHex("test-key-hash"));
export const SUB_ID = 42n;
export const CALLBACK_GAS = 300_000;
export const TURN_DURATION = 600n;
export const SETTLE_GRACE = 3_600n;
export const VRF_TIMEOUT = 86_400n;
export const CLAIM_WINDOW = 30n * DAY;

export type Dice = readonly [number, number, number, number, number];

export async function connect() {
  return network.create();
}

export type Conn = Awaited<ReturnType<typeof connect>>;

export async function deployGame(conn: Conn) {
  const { viem } = conn;
  const [owner, alice, bob, carol, charity, stranger] = await viem.getWalletClients();
  const vrf = await viem.deployContract("MockVRFCoordinator");
  const bar = await viem.deployContract("BarDice", [
    owner.account.address,
    ENTRY_FEE,
    charity.account.address,
    DAY_START_OFFSET,
    {
      coordinator: vrf.address,
      keyHash: KEY_HASH,
      subscriptionId: SUB_ID,
      requestConfirmations: 3,
      callbackGasLimit: CALLBACK_GAS,
      nativePayment: false,
    },
  ]);
  const publicClient = await viem.getPublicClient();
  return { bar, vrf, owner, alice, bob, carol, charity, stranger, publicClient };
}

export type Game = Awaited<ReturnType<typeof deployGame>>;

/** Jump to `secondsIntoDay` seconds after the start of the next bar day. Returns that day index. */
export async function startOfNextDay(conn: Conn, secondsIntoDay = 60n): Promise<bigint> {
  const now = BigInt(await conn.networkHelpers.time.latest());
  const day = (now - DAY_START_OFFSET) / DAY + 1n;
  await conn.networkHelpers.time.increaseTo(day * DAY + DAY_START_OFFSET + secondsIntoDay);
  return day;
}

export async function settleableAt(g: Game, day: bigint) {
  return g.bar.read.settleableAt([day]);
}

/** Latest VRF request id issued for `player`'s turn. */
export async function pendingRequest(g: Game, player: `0x${string}`) {
  const turn = await g.bar.read.getTurn([player]);
  return turn.requestId;
}

export async function fulfillDice(g: Game, player: `0x${string}`, dice: Dice) {
  const id = await pendingRequest(g, player);
  await g.vrf.write.fulfillDice([id, dice]);
}

/** Enter as `who` and resolve the first roll to `dice`. */
export async function enterWith(g: Game, who: Game["alice"], dice: Dice) {
  await g.bar.write.enter({ value: ENTRY_FEE, account: who.account });
  await fulfillDice(g, who.account.address, dice);
}

/** Total funds the contract owes, which must never exceed its balance. */
export async function liabilities(g: Game) {
  const [pot, escrow, openEntries, prizeLiability, charityBalance] = await Promise.all([
    g.bar.read.pot(),
    g.bar.read.escrow(),
    g.bar.read.openEntries(),
    g.bar.read.prizeLiability(),
    g.bar.read.charityBalance(),
  ]);
  return pot + escrow + openEntries + prizeLiability + charityBalance;
}

export async function balanceOf(g: Game, address: `0x${string}`) {
  return g.publicClient.getBalance({ address });
}

/** Deterministic PRNG (mulberry32) so fuzz runs are reproducible from a seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
