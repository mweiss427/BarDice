import { useConnection } from "wagmi";
import { ConnectButton } from "./components/ConnectButton";
import { MyDays, WallOfFame } from "./components/History";
import { PotPanel } from "./components/PotPanel";
import { TurnPanel } from "./components/TurnPanel";
import { appConfig } from "./config";
import { useBarAction, useGame, useRefreshOnNewBlock } from "./lib/useBarDice";

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-amber-300">🎲 Bar Dice</h1>
          <p className="text-stone-400">Shake of the Day — a Wisconsin bar classic, provably fair on {appConfig.chain.name}.</p>
        </div>
        <ConnectButton />
      </header>
      {appConfig.barDiceAddress ? <Game /> : <Setup />}
      <Rules />
    </div>
  );
}

function Game() {
  const { block, now } = useRefreshOnNewBlock();
  const game = useGame();
  const action = useBarAction();
  const { isConnected } = useConnection();

  if (game.error) return <p className="text-red-400">Couldn't reach the bar: {game.error.message}</p>;
  return (
    <main className="flex flex-col gap-6">
      <PotPanel game={game} now={now} />
      {isConnected ? (
        <TurnPanel game={game} action={action} now={now} />
      ) : (
        <p className="rounded-3xl bg-stone-900/70 p-6 text-center text-stone-300 ring-1 ring-stone-700">
          Connect a wallet to take your shake.
        </p>
      )}
      {action.error && (
        <div role="alert" className="flex items-center justify-between rounded-xl bg-red-950/70 p-3 text-red-200 ring-1 ring-red-800">
          <span>{action.error}</span>
          <button className="text-sm underline" onClick={action.clearError}>dismiss</button>
        </div>
      )}
      <MyDays action={action} block={block} now={now} />
      <WallOfFame block={block} />
    </main>
  );
}

function Setup() {
  return (
    <p className="rounded-xl bg-amber-950/60 p-4 text-amber-200">
      No contract configured. Run <code>pnpm chain</code> and <code>pnpm deploy:local</code>, or set{" "}
      <code>VITE_BARDICE_ADDRESS</code>.
    </p>
  );
}

function Rules() {
  return (
    <details className="rounded-2xl bg-stone-900/50 p-4 text-stone-300 ring-1 ring-stone-800">
      <summary className="cursor-pointer font-semibold text-stone-200">House rules</summary>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>One shake per wallet per bar day (the day turns over at midnight Central).</li>
        <li>Up to three rolls. Between rolls, tap dice to farm (keep) them — farmed dice stay put.</li>
        <li>Score = how many dice match, then which face: two 5s is 25, four 5s is 45, five 6s (56) is the best.</li>
        <li>Each night, half the pot is paid out: 95% to the top score (ties split), 5% to charity. The rest rolls over.</li>
        <li>Winners have 30 days to claim. Unclaimed prizes go to charity.</li>
        <li>Dice come from Chainlink VRF — nobody, including the house, can predict or pick them.</li>
      </ul>
    </details>
  );
}
