import { Button, Divider } from "antd";
import React, { useState } from "react";
import { ethers } from "ethers";
import { useContractReader } from "eth-hooks";
import "react-dice-complete/dist/react-dice-complete.css";

export default function BarDice({ tx, readContracts, writeContracts }) {
  const player = useContractReader(readContracts, "TheBar", "player");
  const viewDice = useContractReader(readContracts, "TheBar", "viewDice");
  const viewCup = useContractReader(readContracts, "TheBar", "viewCup");
  const rollCount = useContractReader(readContracts, "TheBar", "rollCount");

  const handleButtonClick = async (method, ...args) => {
    const result = tx(writeContracts.TheBar[method](...args), (update) => {
      console.log("📡 Transaction Update:", update);
      if (update && (update.status === "confirmed" || update.status === 1)) {
        console.log(" 🍾 Transaction " + update.hash + " finished!");
        console.log(
          " ⛽️ " +
            update.gasUsed +
            "/" +
            (update.gasLimit || update.gas) +
            " @ " +
            parseFloat(update.gasPrice) / 1000000000 +
            " gwei"
        );
      }
    });
    console.log("awaiting metamask/web3 confirm result...", result);
    console.log(await result);
  };

  return (
    <div>
      <div
        style={{
          border: "1px solid #cccccc",
          padding: 16,
          width: 800,
          margin: "auto",
          marginTop: 64,
        }}
      >
        <h2>Bar Dice:</h2>
        <h4>Hello: {player}</h4>
        <>rollCount: {rollCount}</>
        <Divider />
        <div style={{ margin: 8 }}>
          <Button
            style={{ marginTop: 8, color: "blue" }}
            onClick={() =>
              handleButtonClick("loadCup", {
                value: ethers.utils.parseEther(".01"),
              })
            }
          >
            Play the game
          </Button>
        </div>
        
        <div>
          <Button onClick={() => handleButtonClick("rollDice")}>
            Roll the dice!
          </Button>
        </div>
        <div>
          {[0, 1, 2, 3, 4].map((i) => (
            <Button
              key={i}
              style={{ marginTop: 8 }}
              onClick={() => handleButtonClick("farm", i)}
            >
              Hold dice
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
