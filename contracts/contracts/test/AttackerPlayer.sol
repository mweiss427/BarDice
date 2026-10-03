// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IBarDice {
    function enter() external payable returns (uint256);
    function stand() external;
    function claim(uint256 day) external;
    function refund() external;
    function settleDay(uint256 day) external;
    function withdrawCharity() external;
}

/// @notice A malicious player contract used in tests: when it receives ETH it tries to call
///         back into the game (double-claim, settle, refund...) to steal funds.
contract AttackerPlayer {
    IBarDice public immutable bar;
    uint256 public targetDay;
    uint256 public reentryAttempts;
    uint256 public reentrySuccesses;

    constructor(IBarDice bar_) {
        bar = bar_;
    }

    function enter() external payable {
        bar.enter{value: msg.value}();
    }

    function stand() external {
        bar.stand();
    }

    function claim(uint256 day) external {
        targetDay = day;
        bar.claim(day);
    }

    function refund() external {
        bar.refund();
    }

    receive() external payable {
        if (reentryAttempts >= 3) return;
        reentryAttempts++;
        try bar.claim(targetDay) {
            reentrySuccesses++;
        } catch {}
        try bar.refund() {
            reentrySuccesses++;
        } catch {}
    }
}
