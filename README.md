# 🎲 Bar Dice — Shake of the Day

Bar dice is played at bars all over Wisconsin. Every bar has its own house rules, but the idea is
always the same: it's cheap to play, the pot is big, and you want to roll the same numbers.
This version runs on Ethereum (Base L2), so the dice are provably fair and the pot can't be touched
by anyone, including the house.

## House rules

- **One shake per wallet per bar day.** The day turns over at midnight US Central.
- **Pay the entry fee (0.1 ETH)** and the cup is shaken for you: five dice.
- **Up to three rolls.** Between rolls you can **farm** (keep) dice. Farmed dice stay put for the rest of the turn.
  You can **stand** at any point to lock in your score.
- **Scoring is a two-digit number.** The first digit is how many dice match; the second is which face.
  `2,3,4,5,5` → **25** (two 5s). Farm the 5s, roll `5,5,1,5,5` → **45**. Five 6s (**56**) is the best.
  Ties in count go to the higher face; with no matches your high die counts (e.g. **16**).
- **Each night, half the pot is paid out:** 95% to the top score of the day (ties split evenly)
  and 5% to charity. The other half rolls over, so the pot keeps growing.
- **Winners have 30 days to claim.** Unclaimed prizes go to charity.

Example: 50 players → 5 ETH in. 2.5 ETH is the prize pool: **2.375 ETH** to the winner(s), **0.125 ETH** to charity, 2.5 ETH rolls into tomorrow.

## What's in the box

```
contracts/   Solidity 0.8.30 · Hardhat 3 · viem · OpenZeppelin 5 · Chainlink VRF v2.5
web/         Vite · React 19 · TypeScript · wagmi 3 / viem · TanStack Query · Tailwind 4
.github/     CI: build, tests, fuzz/invariant tests, coverage, Slither, E2E, dependency audit
```

| | |
|---|---|
| Package manager | pnpm 10 workspaces (blocks dependency install scripts; refuses packages < 3 days old) |
| Contract tests | `node:test` + viem (38 scenario tests) and Solidity fuzz + stateful invariant tests |
| Static analysis | Slither — CI fails on any low-or-higher finding |
| Web tests | Vitest + Testing Library (unit), Playwright (full game in a real browser against a local chain) |

The legacy scaffold-eth app still lives in `packages/` for reference; it is no longer part of the workspace.

## Quick start

Requires Node 22.10+ and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm compile                 # build contracts + export the ABI to the web app

# three terminals:
pnpm chain                   # local Hardhat node
pnpm deploy:local            # deploy mock VRF + BarDice, writes web/.env.local
pnpm --filter @bardice/contracts vrf:autofulfill   # plays Chainlink: answers roll requests with random numbers
pnpm dev                     # http://localhost:5173
```

Import one of the Hardhat test accounts printed by `pnpm chain` into your wallet and connect to `localhost:8545` (chain id 31337).

## Testing

```bash
pnpm test:contracts          # unit + fuzz + invariant tests
pnpm --filter @bardice/contracts coverage
pnpm slither                 # needs: pip install slither-analyzer solc-select && solc-select use 0.8.30
pnpm test:web                # Vitest
pnpm test:e2e                # Playwright: boots chain, deploys, builds, plays a full night
```

## Deploying (Base Sepolia → Base)

1. Create a [Chainlink VRF v2.5 subscription](https://vrf.chain.link) on the target network and fund it.
2. Copy `contracts/ignition/parameters/baseSepolia.example.json` to `baseSepolia.json` and fill in the
   owner (use a Safe multisig), charity address, VRF coordinator, key hash and subscription id from
   [Chainlink's docs](https://docs.chain.link/vrf/v2-5/supported-networks).
3. Store secrets encrypted, never in `.env`:
   `pnpm --filter @bardice/contracts exec hardhat keystore set BASE_SEPOLIA_RPC_URL` (and `BASE_SEPOLIA_PRIVATE_KEY`).
4. `pnpm --filter @bardice/contracts exec hardhat ignition deploy ignition/modules/BarDice.ts --network baseSepolia --parameters ignition/parameters/baseSepolia.json --verify`
5. Add the deployed BarDice address as a **consumer** on your VRF subscription.
6. Build the site with `VITE_CHAIN=baseSepolia VITE_BARDICE_ADDRESS=0x… VITE_BARDICE_DEPLOY_BLOCK=… pnpm --filter @bardice/web build`
   and host `web/dist` (the `_headers` file sets security headers on Cloudflare Pages / Netlify).

## Security

See [SECURITY.md](SECURITY.md) for the threat model and how to report a vulnerability.
