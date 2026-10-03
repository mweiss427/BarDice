// Production deploy (Base / Base Sepolia) using Chainlink VRF v2.5.
//   pnpm hardhat ignition deploy ignition/modules/BarDice.ts --network baseSepolia \
//     --parameters ignition/parameters/baseSepolia.json
// After deploying, add the BarDice address as a consumer on your VRF subscription.
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("BarDice", (m) => {
  const owner = m.getParameter<string>("owner");
  const charity = m.getParameter<string>("charity");
  const entryFeeWei = m.getParameter<bigint>("entryFeeWei", 100_000_000_000_000_000n); // 0.1 ETH
  const dayStartOffset = m.getParameter<bigint>("dayStartOffset", 21_600n); // midnight US Central
  const vrf = {
    coordinator: m.getParameter<string>("vrfCoordinator"),
    keyHash: m.getParameter<string>("vrfKeyHash"),
    subscriptionId: m.getParameter<bigint>("vrfSubscriptionId"),
    requestConfirmations: m.getParameter<number>("vrfRequestConfirmations", 3),
    callbackGasLimit: m.getParameter<number>("vrfCallbackGasLimit", 300_000),
    nativePayment: m.getParameter<boolean>("vrfNativePayment", false),
  };

  const barDice = m.contract("BarDice", [owner, entryFeeWei, charity, dayStartOffset, vrf]);
  return { barDice };
});
