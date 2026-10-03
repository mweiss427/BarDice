// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BarDice} from "../contracts/BarDice.sol";
import {MockVRFCoordinator} from "../contracts/test/MockVRFCoordinator.sol";

/// @dev Minimal cheatcode interface (the subset of forge-std's Vm we need).
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

function deployGame() returns (BarDice bar, MockVRFCoordinator vrf) {
    vrf = new MockVRFCoordinator();
    bar = new BarDice(
        address(0xA11CE),
        0.1 ether,
        payable(address(0xC4A817)),
        6 hours,
        BarDice.VrfConfig({
            coordinator: address(vrf),
            keyHash: keccak256("key"),
            subscriptionId: 1,
            requestConfirmations: 3,
            callbackGasLimit: 300_000,
            nativePayment: false
        })
    );
}

/// @notice Stateless fuzzing of the scoring rule against a straightforward reference model.
contract ScoreFuzzTest {
    BarDice internal bar;

    function setUp() public {
        (bar,) = deployGame();
    }

    function testFuzz_scoreMatchesReference(uint8[5] memory raw) public view {
        uint8[5] memory dice;
        uint8[7] memory counts;
        for (uint256 i; i < 5; ++i) {
            dice[i] = (raw[i] % 6) + 1;
            counts[dice[i]]++;
        }
        uint8 score = bar.scoreDice(dice);
        uint8 n = score / 10;
        uint8 face = score % 10;

        require(n >= 1 && n <= 5, "count digit out of range");
        require(face >= 1 && face <= 6, "face digit out of range");
        require(counts[face] == n, "count digit must match the face's occurrences");
        for (uint8 f = 1; f <= 6; ++f) {
            require(counts[f] < n || (counts[f] == n && f <= face), "a better match was ignored");
        }
    }
}

/// @notice Drives random sequences of real game actions for the invariant fuzzer.
contract Handler {
    BarDice public immutable bar;
    MockVRFCoordinator public immutable vrf;
    address[4] public players = [address(0x1001), address(0x1002), address(0x1003), address(0x1004)];
    uint256[] public days_;
    mapping(uint256 => bool) internal seenDay;

    uint256 public calls;

    constructor(BarDice bar_, MockVRFCoordinator vrf_) {
        bar = bar_;
        vrf = vrf_;
        vrf_.setStrict(true);
    }

    function _player(uint256 seed) internal view returns (address) {
        return players[seed % players.length];
    }

    function enter(uint256 seed) external {
        address p = _player(seed);
        vm.deal(p, 1 ether);
        uint256 day = bar.currentDay();
        vm.prank(p);
        try bar.enter{value: 0.1 ether}() {
            if (!seenDay[day]) {
                seenDay[day] = true;
                days_.push(day);
            }
        } catch {}
        calls++;
    }

    function fulfil(uint256 seed, uint256 word) external {
        BarDice.Turn memory t = bar.getTurn(_player(seed));
        if (t.pending && bar.requestPlayer(t.requestId) != address(0)) {
            vrf.fulfill(t.requestId, word); // strict: reverts the call (and the run) if the callback fails
        }
        calls++;
    }

    function roll(uint256 seed, uint8 mask) external {
        address p = _player(seed);
        BarDice.Turn memory t = bar.getTurn(p);
        vm.prank(p);
        try bar.roll(uint8(mask % 31) | t.heldMask) {} catch {}
        calls++;
    }

    function stand(uint256 seed) external {
        vm.prank(_player(seed));
        try bar.stand() {} catch {}
        calls++;
    }

    function refund(uint256 seed) external {
        vm.prank(_player(seed));
        try bar.refund() {} catch {}
        calls++;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + (secs % 3 days));
        calls++;
    }

    function settle(uint256 idx) external {
        if (days_.length == 0) return;
        try bar.settleDay(days_[idx % days_.length]) {} catch {}
        calls++;
    }

    function claim(uint256 seed, uint256 idx) external {
        if (days_.length == 0) return;
        vm.prank(_player(seed));
        try bar.claim(days_[idx % days_.length]) {} catch {}
        calls++;
    }

    function sweep(uint256 idx) external {
        if (days_.length == 0) return;
        try bar.sweepUnclaimed(days_[idx % days_.length]) {} catch {}
        calls++;
    }

    function withdrawCharity() external {
        try bar.withdrawCharity() {} catch {}
        calls++;
    }

    function donate(uint96 amount) external {
        uint256 a = amount % 1 ether;
        vm.deal(address(this), a);
        bar.donate{value: a}();
        calls++;
    }

    function dayCount() external view returns (uint256) {
        return days_.length;
    }
}

/// @notice Stateful invariant tests: whatever sequence of actions happens, the books balance.
contract BarDiceInvariantTest {
    BarDice internal bar;
    MockVRFCoordinator internal vrf;
    Handler internal handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        (bar, vrf) = deployGame();
        handler = new Handler(bar, vrf);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// Every wei the contract holds is accounted for, and it can always pay everything it owes.
    function invariant_accountingIsExact() public view {
        uint256 owed = bar.pot() + bar.escrow() + bar.openEntries() + bar.prizeLiability() + bar.charityBalance();
        require(address(bar).balance == owed, "balance != liabilities");
    }

    /// Escrow only ever holds fees for turns whose first roll is still outstanding.
    function invariant_escrowIsWholeFees() public view {
        require(bar.escrow() % bar.ENTRY_FEE() == 0, "escrow holds a partial fee");
    }

    /// Settled days never owe more than they promised; winners and claims stay consistent.
    function invariant_dayBookkeeping() public view {
        uint256 n = handler.dayCount();
        for (uint256 i; i < n; ++i) {
            BarDice.Day memory d = bar.getDay(handler.days_(i));
            require(d.claimed <= d.winners, "more claims than winners");
            if (d.winners > 0) require(d.topScore >= 11 && d.topScore <= 56, "impossible top score");
            if (!d.settled) require(d.prizePerWinner == 0 && d.claimed == 0, "paid before settlement");
        }
    }
}
