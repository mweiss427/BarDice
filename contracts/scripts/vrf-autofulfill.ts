// LOCAL ONLY: plays the role of Chainlink VRF by answering every request with a
// cryptographically random word. On testnet/mainnet the real Chainlink network does this.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { network } from "hardhat";
import { bytesToBigInt } from "viem";

const deployment = JSON.parse(readFileSync(new URL("../deployments/localhost.json", import.meta.url), "utf8"));
const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const vrf = await viem.getContractAt("MockVRFCoordinator", deployment.vrfCoordinator);

let fromBlock = BigInt(deployment.deployBlock);
console.log("auto-fulfilling VRF requests on", deployment.vrfCoordinator);

for (;;) {
  const toBlock = await publicClient.getBlockNumber();
  if (toBlock >= fromBlock) {
    const events = await vrf.getEvents.RandomWordsRequested({}, { fromBlock, toBlock });
    for (const e of events) {
      const id = e.args.requestId!;
      const [, , fulfilled] = await vrf.read.requests([id]);
      if (fulfilled) continue;
      await vrf.write.fulfill([id, bytesToBigInt(randomBytes(32))]);
      console.log("fulfilled request", id);
    }
    fromBlock = toBlock + 1n;
  }
  await new Promise((r) => setTimeout(r, 500));
}
