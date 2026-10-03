import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { appConfig } from "../config";

export function ConnectButton() {
  const { address, chainId, isConnected } = useConnection();
  const connectors = useConnectors();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (isConnected && address) {
    if (chainId !== appConfig.chain.id) {
      return (
        <button className="btn-primary" onClick={() => switchChain({ chainId: appConfig.chain.id })}>
          Switch to {appConfig.chain.name}
        </button>
      );
    }
    return (
      <button className="btn-secondary" onClick={() => disconnect()} title="Disconnect" data-testid="account">
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }
  // Prefer specific EIP-6963 wallets over the generic "Injected" fallback when any are found.
  const specific = connectors.filter((c) => c.id !== "injected");
  const list = specific.length ? specific : connectors;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((c) => (
        <button key={c.uid} className="btn-primary" disabled={isPending} onClick={() => connect({ connector: c })}>
          {list.length === 1 ? "Connect wallet" : `Connect ${c.name}`}
        </button>
      ))}
    </div>
  );
}
