// Local development deploy: a mock VRF coordinator + BarDice, then writes web/.env.local.
// Real networks use Ignition (ignition/modules/BarDice.ts) with Chainlink's real coordinator.
import { mkdirSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { keccak256, parseEther, toHex } from "viem";

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [owner, , , , , , , , , charity] = await viem.getWalletClients();

const vrf = await viem.deployContract("MockVRFCoordinator");
const bar = await viem.deployContract("BarDice", [
  owner.account.address,
  parseEther("0.1"),
  charity.account.address,
  6n * 3600n,
  {
    coordinator: vrf.address,
    keyHash: keccak256(toHex("local")),
    subscriptionId: 1n,
    requestConfirmations: 1,
    callbackGasLimit: 300_000,
    nativePayment: false,
  },
]);
const block = await publicClient.getBlockNumber();
const chainId = await publicClient.getChainId();

const deployment = { chainId, barDice: bar.address, vrfCoordinator: vrf.address, deployBlock: Number(block) };
mkdirSync(new URL("../deployments", import.meta.url), { recursive: true });
writeFileSync(new URL("../deployments/localhost.json", import.meta.url), JSON.stringify(deployment, null, 2));
writeFileSync(
  new URL("../../web/.env.local", import.meta.url),
  [`VITE_CHAIN=localhost`, `VITE_BARDICE_ADDRESS=${bar.address}`, `VITE_BARDICE_DEPLOY_BLOCK=${block}`, ""].join("\n"),
);
console.log("BarDice:", bar.address);
console.log("MockVRFCoordinator:", vrf.address);
console.log("wrote deployments/localhost.json and web/.env.local");
