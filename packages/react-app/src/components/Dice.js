import React, { useEffect, useState, useRef } from "react";
import ReactDice from "react-dice-complete";
import "react-dice-complete/dist/react-dice-complete.css";

const Dice = ({ contract, isRolling }) => {
  const [diceValues, setDiceValues] = useState([]);
  const diceRef = useRef();

  useEffect(() => {
    const fetchDiceValues = async () => {
      if (contract) {
        const values = await contract.viewDice();
        setDiceValues(values.map((value) => value + 1));
      }
    };

    fetchDiceValues();
  }, [contract]);

  useEffect(() => {
    if (diceRef.current && diceValues.length > 0 && !isRolling) {
      diceRef.current.rollAll(diceValues);
    }
  }, [diceValues, isRolling]);

  const handleDiceRoll = (total, individualValues) => {
    console.log(`Total: ${total}, Individual values: ${individualValues}`);
  };

  if (!diceValues.length) {
    return <div>Loading dice...</div>;
  }

  return (
    <div>
      <ReactDice
        numDice={diceValues.length}
        disableIndividual={true}
        faceColor="#ffffff"
        dotColor="#000000"
        dieSize={50}
        rollDone={handleDiceRoll}
        ref={diceRef}
      />
    </div>
  );
};

export default Dice;
