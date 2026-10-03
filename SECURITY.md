# Security

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private
[security advisory](https://github.com/mweiss427/BarDice/security/advisories/new) form instead.

## Threat model

`contracts/contracts/BarDice.sol` holds player funds. These are the properties it is designed to guarantee,
and the tests that check them.

| Property | How | Tested by |
|---|---|---|
| Nobody can predict or choose dice | Dice come only from Chainlink VRF v2.5. The coordinator is **immutable** (we don't inherit `VRFConsumerBaseV2Plus`, whose owner can swap the coordinator). | `only the VRF coordinator can deliver randomness`, `the old exploit is gone` |
| A player can't back out of a bad roll | No cancel / re-request. The VRF callback never reverts for a valid caller. Refunds open only 24h after an unanswered first roll. | `cannot refund once the first roll has landed`, VRF failure tests |
| No reentrancy | Checks-effects-interactions everywhere, `ReentrancyGuard` on every state-changing entry point, pull-based payouts | `a malicious winner contract cannot re-enter claim or refund` |
| One player can't block others | Every player has an independent turn; no global "current player" lock | `an abandoned turn never blocks anyone else` |
| The contract can always pay what it owes | Exact accounting: `balance == pot + escrow + openEntries + prizeLiability + charityBalance` | Stateful invariant fuzzing (`BarDice.invariants.t.sol`) |
| The owner can't rug | The owner can only pause **new entries**. No withdraw, no fee/charity/VRF setters. Claims, refunds and settlement work while paused. Ownership transfer is two-step. | `exposes no way for the owner to move funds or change randomness`, `pausing stops new entries but nothing else` |
| Charity funds only go to charity | Charity address is immutable; anyone may trigger the push, nobody may redirect it | `unclaimed prizes go to charity after 30 days` |

### Known trade-offs

- **Sybil players.** "One shake per day" is per wallet. Someone with many wallets can shake many times,
  but each shake costs the full entry fee and grows the pot, so there's no free edge.
- **VRF liveness.** If Chainlink stops answering, turns stall. Players can refund an unanswered first
  roll after 24h, and the owner can pause new entries. A roll that lands after its day was settled
  feeds the pot but can't win.
- **Front-running a late VRF answer.** A player could watch the mempool for a VRF answer delivered more
  than 24h late and race a refund. On Base the sequencer mempool is private, and the 24h window
  makes this impractical.
- **Block timestamps.** Day and turn windows run from minutes to days, so the seconds of timestamp
  wiggle a sequencer has don't matter.
- **The VRF subscription is funded by the operator**, not by players.

### Supply chain

- pnpm refuses to install any package version published less than 3 days ago (`minimumReleaseAge`),
  blocks dependency install scripts except an allow-list, and blocks git/tarball sub-dependencies.
- The lockfile is frozen in CI. Dependabot proposes updates after a 7-day cooldown.
- The web app ships a strict Content-Security-Policy (`script-src 'self'`, `connect-src` limited to the
  configured RPC) plus anti-clickjacking headers. It loads no third-party scripts and simulates every
  transaction before asking the wallet to sign.

### Before mainnet

- [ ] Get an independent audit.
- [ ] Use a Safe multisig as the contract owner.
- [ ] Run on Base Sepolia with real VRF for at least a week.
- [ ] Pin GitHub Actions to commit SHAs (Dependabot will keep them updated).
