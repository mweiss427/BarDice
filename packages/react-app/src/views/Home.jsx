import React from "react";
import { Button } from "antd";
import { utils } from "ethers";
import { useContractReader } from "eth-hooks";

function Home({ yourLocalBalance, readContracts, tx, writeContracts }) {
  const player = useContractReader(readContracts, "YourContract", "player");

  const handleButtonClick = () => {
    console.log("writeContracts:", writeContracts);
    if (!writeContracts || !writeContracts.YourContract) {
      alert("YourContract is not available. Make sure it is properly deployed and accessible.");
      return;
    }
    tx({
      to: writeContracts.YourContract.address,
      value: utils.parseEther("0.01"),
    });
  };

  return (
    <div>
      Hello {player}
      <div>
        <Button onClick={handleButtonClick}>Play Game</Button>
      </div>
    </div>
  );
}

export default Home;
