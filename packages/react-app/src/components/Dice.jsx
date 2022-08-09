
import React, { useState } from "react";
import { useContractReader } from "eth-hooks";

export default function Dice(props) {
  let listItems = props.dice;
  
  if(Array.isArray(listItems)){
    console.log(props);
    listItems = listItems.map((x, i) => <span style={{ color: "blue" }}> {x + 1} </span>);
  }
  
    return (
      <>
          Dice
        <div>
          {listItems}
        </div>
      </>
      
    )
}


function getcolor(){

}
