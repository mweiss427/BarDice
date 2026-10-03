import { createConfig, http } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import { appConfig } from "./config";

const { chain, rpcUrl, e2eAccount } = appConfig;

export const wagmiConfig = createConfig({
  chains: [chain],
  // EIP-6963 discovery finds every installed browser wallet (MetaMask, Rabby, Coinbase, ...).
  multiInjectedProviderDiscovery: true,
  connectors: e2eAccount && chain.id === 31337 ? [mock({ accounts: [e2eAccount] })] : [injected()],
  transports: { [chain.id]: http(rpcUrl) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
