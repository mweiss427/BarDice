pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";

// import "@openzeppelin/contracts/access/Ownable.sol";
// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract TheBar {
    event SetPurpose(address sender, string purpose);

    string public purpose = "Building Unstoppable Apps!!!";
    uint8[5] public dice;
    bool[5] public isInCup;
    uint8 public rollCount;
    address public player;

    constructor() payable {
        // what should we do on deploy?
    }

    function rollDice() public {
        require(rollCount < 3, "Out of rolls");
        require(player == msg.sender, "You're not the player");
        rollCount++;
        bytes32 todoRandom = keccak256(
            abi.encodePacked(
                block.difficulty,
                address(this),
                msg.sender,
                block.difficulty - 1
            )
        );
        for (uint256 i = 0; i < 5; i++) {
            if (isInCup[i]) {
                dice[i] = uint8(todoRandom[i]) % 6;
            }
        }

        if (
            dice[0] == 0 &&
            dice[1] == 0 &&
            dice[2] == 0 &&
            dice[3] == 0 &&
            dice[4] == 0
        ) {
            (bool sent, ) = msg.sender.call{
                value: ((address(this).balance * 50) / 100)
            }("");
            player = address(0x0); // if they win they will not catch the if statement
            require(sent, "Failed to send Ether");
        }

        if (rollCount == 3) {
            player = address(0x0);
        }
    }

    function viewDice() public view returns (uint8[5] memory) {
        return dice;
    }

    function viewCup() public view returns (bool[5] memory) {
        return isInCup;
    }

    function viewRollCount() public view returns (uint8) {
        return rollCount;
    }

    function farm(uint8 diceNumber) public {
        require(diceNumber >= 0, "To Small");
        require(diceNumber <= 5, "To big");
        require(rollCount < 3, "Out of turns");
        require(rollCount > 0, "You must roll before farming");
        require(player == msg.sender);
        isInCup[diceNumber] = false;
    }

    function loadCup() public payable {
        require(msg.value == .01 ether, "need .01 ether");
        require(player == address(0x0), "Wait ur turn");
        for (uint256 i = 0; i < 5; i++) {
            isInCup[i] = true;
        }
        rollCount = 0;
        console.log(player);
        player = msg.sender;
    }

    // to support receiving ETH by default
    receive() external payable {}

    fallback() external payable {}
}
