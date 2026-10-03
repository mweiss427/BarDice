import { getAddress, isAddress, type Address } from "viem";
import { base, baseSepolia, hardhat, type Chain } from "viem/chains";

const CHAINS: Record<string, Chain> = { localhost: hardhat, baseSepolia, base };

const chainKey = import.meta.env.VITE_CHAIN ?? "localhost";
const chain = CHAINS[chainKey];
if (!chain) throw new Error(`Unknown VITE_CHAIN "${chainKey}"`);

const rawAddress = import.meta.env.VITE_BARDICE_ADDRESS ?? "";

export const appConfig = {
  chain,
  rpcUrl: (import.meta.env.VITE_RPC_URL as string | undefined) || undefined,
  barDiceAddress: isAddress(rawAddress) ? (getAddress(rawAddress) as Address) : undefined,
  deployBlock: BigInt(import.meta.env.VITE_BARDICE_DEPLOY_BLOCK || 0),
  /** E2E only: connect a test account through the local node instead of a browser wallet. */
  e2eAccount: import.meta.env.VITE_E2E_ACCOUNT as Address | undefined,
};
