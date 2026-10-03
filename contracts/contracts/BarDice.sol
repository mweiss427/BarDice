// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IVRFCoordinatorV2Plus, VRFV2PlusClient} from "./vrf/VRFV2PlusClient.sol";

/// @title Bar Dice — Shake of the Day
/// @notice Wisconsin bar dice on-chain. Pay the entry fee, get up to three rolls of five dice,
///         "farm" (hold) dice between rolls, and post the best score of the day.
///         Each settled day pays 50% of the pot: 95% to the day's top scorer(s), 5% to charity.
///         The other 50% rolls over to grow tomorrow's pot.
///
/// Security model
/// - Randomness comes only from Chainlink VRF v2.5. The coordinator is immutable, so no one
///   (including the owner) can redirect randomness or pick dice.
/// - Each player has an independent turn, so one player can never block another.
/// - Players cannot cancel or re-request a roll after it is requested.
/// - All payouts are pull-based (claim / withdraw), follow checks-effects-interactions and are
///   guarded by ReentrancyGuard.
/// - The owner can only pause *new entries*. The owner cannot move funds, change fees,
///   change the charity, or touch randomness. Claims, refunds and settlement work while paused.
contract BarDice is Ownable2Step, Pausable, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum TurnStatus {
        None,
        Active,
        Finished,
        Refunded
    }

    struct Turn {
        uint256 requestId; // latest VRF request for this turn
        uint64 day; // bar day the turn belongs to
        uint64 startedAt;
        uint8 rolls; // fulfilled rolls (0..3)
        uint8 heldMask; // bit i set => die i is farmed and never re-rolled
        bool pending; // waiting on VRF
        TurnStatus status;
        uint8[5] dice; // faces 1..6 (0 before the first roll)
    }

    struct Day {
        uint128 entries; // committed entry fees for the day (moved out of escrow on first roll)
        uint128 prizePerWinner;
        uint32 players;
        uint32 winners;
        uint32 claimed;
        uint8 topScore;
        bool settled;
        bool swept;
        uint64 settledAt;
    }

    // ---------------------------------------------------------------------
    // Constants & immutables
    // ---------------------------------------------------------------------

    uint8 public constant NUM_DICE = 5;
    uint8 public constant MAX_ROLLS = 3;
    uint8 private constant ALL_HELD = 0x1f;

    uint256 public constant PRIZE_POOL_BPS = 5_000; // 50% of the pot is paid out each day
    uint256 public constant CHARITY_BPS = 500; // 5% of the prize pool goes to charity
    uint256 private constant BPS = 10_000;

    uint256 public constant TURN_DURATION = 10 minutes;
    uint256 public constant SETTLE_GRACE = 1 hours; // extra wait after the last possible turn ends
    uint256 public constant VRF_TIMEOUT = 24 hours; // refund window if the first roll never arrives
    uint256 public constant CLAIM_WINDOW = 30 days;

    uint256 public immutable ENTRY_FEE;
    address payable public immutable CHARITY;
    /// @notice Seconds after 00:00 UTC that a bar day begins (e.g. 6h => midnight US Central Standard).
    uint256 public immutable DAY_START_OFFSET;

    IVRFCoordinatorV2Plus public immutable VRF_COORDINATOR;
    bytes32 public immutable VRF_KEY_HASH;
    uint256 public immutable VRF_SUBSCRIPTION_ID;
    uint16 public immutable VRF_REQUEST_CONFIRMATIONS;
    uint32 public immutable VRF_CALLBACK_GAS_LIMIT;
    bool public immutable VRF_NATIVE_PAYMENT;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    mapping(address player => Turn) private _turns;
    mapping(uint256 requestId => address player) public requestPlayer;
    mapping(uint256 day => Day) private _days;
    mapping(uint256 day => mapping(address player => bool)) public hasPlayed;
    mapping(uint256 day => mapping(address player => uint8)) public scoreOf;
    mapping(uint256 day => mapping(address player => bool)) public hasClaimed;

    /// @notice Rolled-over funds not yet assigned to any day's prize.
    uint256 public pot;
    /// @notice Entry fees whose first roll has not been fulfilled yet (refundable on VRF failure).
    uint256 public escrow;
    /// @notice Committed entry fees for days that have not been settled yet.
    uint256 public openEntries;
    /// @notice Prizes owed to winners that have not been claimed or swept.
    uint256 public prizeLiability;
    /// @notice Funds owed to the charity.
    uint256 public charityBalance;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Entered(address indexed player, uint256 indexed day, uint256 requestId);
    event RollRequested(address indexed player, uint256 indexed day, uint8 heldMask, uint256 requestId);
    event Rolled(address indexed player, uint256 indexed day, uint8 roll, uint8[5] dice);
    event TurnFinished(address indexed player, uint256 indexed day, uint8 score);
    event TurnVoided(address indexed player, uint256 indexed day);
    event Refunded(address indexed player, uint256 indexed day, uint256 amount);
    event DaySettled(
        uint256 indexed day, uint8 topScore, uint32 winners, uint256 prizePerWinner, uint256 charityCut, uint256 potAfter
    );
    event PrizeClaimed(uint256 indexed day, address indexed player, uint256 amount);
    event PrizeSwept(uint256 indexed day, uint256 amount);
    event CharityWithdrawn(address indexed charity, uint256 amount);
    event Donated(address indexed from, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error InvalidConfig();
    error WrongEntryFee(uint256 sent, uint256 required);
    error AlreadyPlayedToday();
    error TurnInProgress();
    error NoActiveTurn();
    error RollPending();
    error NoRollsLeft();
    error MustRollFirst();
    error TurnExpired();
    error InvalidHold();
    error OnlyCoordinator(address caller);
    error DayAlreadySettled();
    error DayNotOver();
    error DayNotSettled();
    error NotAWinner();
    error AlreadyClaimed();
    error ClaimWindowClosed();
    error ClaimWindowOpen();
    error NotRefundable();
    error NothingToWithdraw();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    struct VrfConfig {
        address coordinator;
        bytes32 keyHash;
        uint256 subscriptionId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        bool nativePayment;
    }

    constructor(
        address initialOwner,
        uint256 entryFee,
        address payable charity,
        uint256 dayStartOffset,
        VrfConfig memory vrf
    ) Ownable(initialOwner) {
        if (charity == address(0) || vrf.coordinator == address(0)) revert ZeroAddress();
        if (entryFee == 0 || entryFee > type(uint128).max / 1_000_000) revert InvalidConfig();
        if (dayStartOffset >= 1 days) revert InvalidConfig();
        if (vrf.callbackGasLimit < 100_000 || vrf.requestConfirmations == 0) revert InvalidConfig();

        ENTRY_FEE = entryFee;
        CHARITY = charity;
        DAY_START_OFFSET = dayStartOffset;
        VRF_COORDINATOR = IVRFCoordinatorV2Plus(vrf.coordinator);
        VRF_KEY_HASH = vrf.keyHash;
        VRF_SUBSCRIPTION_ID = vrf.subscriptionId;
        VRF_REQUEST_CONFIRMATIONS = vrf.requestConfirmations;
        VRF_CALLBACK_GAS_LIMIT = vrf.callbackGasLimit;
        VRF_NATIVE_PAYMENT = vrf.nativePayment;
    }

    // ---------------------------------------------------------------------
    // Player actions
    // ---------------------------------------------------------------------

    /// @notice Pay the entry fee and shake the cup (first roll is requested immediately).
    function enter() external payable whenNotPaused nonReentrant returns (uint256 requestId) {
        if (msg.value != ENTRY_FEE) revert WrongEntryFee(msg.value, ENTRY_FEE);
        Turn storage t = _turns[msg.sender];
        if (t.status == TurnStatus.Active) revert TurnInProgress();

        uint256 day = currentDay();
        if (hasPlayed[day][msg.sender]) revert AlreadyPlayedToday();
        hasPlayed[day][msg.sender] = true;
        escrow += msg.value;

        delete _turns[msg.sender];
        t.day = uint64(day);
        t.startedAt = uint64(block.timestamp);
        t.status = TurnStatus.Active;
        t.pending = true;

        requestId = _requestRoll(msg.sender, t);
        emit Entered(msg.sender, day, requestId);
    }

    /// @notice Farm (hold) dice and roll the rest. Held dice stay held for the rest of the turn.
    /// @param heldMask bit i set => keep die i. Must include every previously held die.
    function roll(uint8 heldMask) external nonReentrant returns (uint256 requestId) {
        Turn storage t = _turns[msg.sender];
        if (t.status != TurnStatus.Active) revert NoActiveTurn();
        if (t.pending) revert RollPending();
        if (t.rolls == 0) revert MustRollFirst();
        if (t.rolls >= MAX_ROLLS) revert NoRollsLeft();
        if (block.timestamp > t.startedAt + TURN_DURATION) revert TurnExpired();
        if (heldMask >= ALL_HELD || (heldMask & t.heldMask) != t.heldMask) revert InvalidHold();

        t.heldMask = heldMask;
        t.pending = true;
        requestId = _requestRoll(msg.sender, t);
        emit RollRequested(msg.sender, t.day, heldMask, requestId);
    }

    /// @notice Lock in the current dice as your score for the day.
    /// @dev Allowed any time after the first roll until the day is settled.
    function stand() external nonReentrant {
        Turn storage t = _turns[msg.sender];
        if (t.status != TurnStatus.Active) revert NoActiveTurn();
        if (t.pending) revert RollPending();
        if (t.rolls == 0) revert MustRollFirst();
        if (_days[t.day].settled) revert DayAlreadySettled();
        _finish(msg.sender, t);
    }

    /// @notice Recover the entry fee if Chainlink never delivered the first roll.
    /// @dev Only possible VRF_TIMEOUT after entering, so a player cannot "see" a bad roll and back out.
    function refund() external nonReentrant {
        Turn storage t = _turns[msg.sender];
        if (t.status != TurnStatus.Active || t.rolls != 0 || block.timestamp < t.startedAt + VRF_TIMEOUT) {
            revert NotRefundable();
        }
        uint256 day = t.day;
        delete requestPlayer[t.requestId];
        t.status = TurnStatus.Refunded;
        t.pending = false;
        hasPlayed[day][msg.sender] = false;
        escrow -= ENTRY_FEE;

        emit Refunded(msg.sender, day, ENTRY_FEE);
        Address.sendValue(payable(msg.sender), ENTRY_FEE);
    }

    // ---------------------------------------------------------------------
    // VRF callback
    // ---------------------------------------------------------------------

    /// @notice Called by the Chainlink VRF coordinator. Never reverts for a valid caller,
    ///         so a fulfilled request can never be "rejected" to force a re-roll.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(VRF_COORDINATOR)) revert OnlyCoordinator(msg.sender);

        address player = requestPlayer[requestId];
        if (player == address(0) || randomWords.length == 0) return;
        delete requestPlayer[requestId];

        Turn storage t = _turns[player];
        if (t.status != TurnStatus.Active || !t.pending || t.requestId != requestId) return;

        uint256 day = t.day;
        Day storage d = _days[day];
        uint256 word = randomWords[0];
        uint8 held = t.heldMask;

        for (uint256 i = 0; i < NUM_DICE; ++i) {
            if (held & (1 << i) == 0) {
                // 32 independent bits per die; modulo bias is < 1e-9.
                t.dice[i] = uint8(uint32(word >> (32 * i)) % 6) + 1;
            }
        }
        t.pending = false;
        t.rolls += 1;

        if (t.rolls == 1) {
            escrow -= ENTRY_FEE;
            if (d.settled) {
                // The day closed before VRF answered: the fee feeds the pot, no score is recorded.
                pot += ENTRY_FEE;
            } else {
                d.entries += uint128(ENTRY_FEE);
                d.players += 1;
                openEntries += ENTRY_FEE;
            }
        }

        emit Rolled(player, day, t.rolls, t.dice);

        if (d.settled) {
            t.status = TurnStatus.Finished;
            emit TurnVoided(player, day);
        } else if (t.rolls == MAX_ROLLS) {
            _finish(player, t);
        }
    }

    // ---------------------------------------------------------------------
    // Settlement & payouts (anyone can call)
    // ---------------------------------------------------------------------

    /// @notice Close a finished day: split 50% of the pot between the day's winners and charity.
    function settleDay(uint256 day) public nonReentrant {
        _settle(day);
    }

    /// @notice Claim a prize for a day you won. Settles the day first if needed.
    function claim(uint256 day) external nonReentrant {
        Day storage d = _days[day];
        if (!d.settled) _settle(day);
        if (d.swept || block.timestamp > d.settledAt + CLAIM_WINDOW) revert ClaimWindowClosed();
        if (d.winners == 0 || scoreOf[day][msg.sender] != d.topScore) revert NotAWinner();
        if (hasClaimed[day][msg.sender]) revert AlreadyClaimed();

        uint256 amount = d.prizePerWinner;
        hasClaimed[day][msg.sender] = true;
        d.claimed += 1;
        prizeLiability -= amount;

        emit PrizeClaimed(day, msg.sender, amount);
        Address.sendValue(payable(msg.sender), amount);
    }

    /// @notice After the claim window, unclaimed prizes go to charity.
    function sweepUnclaimed(uint256 day) external nonReentrant {
        Day storage d = _days[day];
        if (!d.settled) revert DayNotSettled();
        if (d.swept) revert ClaimWindowClosed();
        if (block.timestamp <= d.settledAt + CLAIM_WINDOW) revert ClaimWindowOpen();

        uint256 amount = uint256(d.prizePerWinner) * (d.winners - d.claimed);
        d.swept = true;
        prizeLiability -= amount;
        charityBalance += amount;
        emit PrizeSwept(day, amount);
    }

    /// @notice Send accumulated charity funds to the immutable charity address.
    function withdrawCharity() external nonReentrant {
        uint256 amount = charityBalance;
        if (amount == 0) revert NothingToWithdraw();
        charityBalance = 0;
        emit CharityWithdrawn(CHARITY, amount);
        Address.sendValue(CHARITY, amount);
    }

    /// @notice Add funds to the rolling pot.
    function donate() external payable {
        pot += msg.value;
        emit Donated(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------------
    // Admin (deliberately minimal)
    // ---------------------------------------------------------------------

    /// @notice Stop new entries (e.g. if VRF is misbehaving). Does not affect claims or refunds.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function currentDay() public view returns (uint256) {
        return (block.timestamp - DAY_START_OFFSET) / 1 days;
    }

    /// @notice Timestamp at which `day` ends.
    function dayEnd(uint256 day) public view returns (uint256) {
        return (day + 1) * 1 days + DAY_START_OFFSET;
    }

    /// @notice Earliest timestamp at which `day` can be settled.
    function settleableAt(uint256 day) public view returns (uint256) {
        return dayEnd(day) + TURN_DURATION + SETTLE_GRACE;
    }

    function getTurn(address player) external view returns (Turn memory) {
        return _turns[player];
    }

    function getDay(uint256 day) external view returns (Day memory) {
        return _days[day];
    }

    /// @notice Bar dice score: tens digit = how many dice match, ones digit = the face that matches.
    ///         Ties in count go to the higher face. Five of a kind sixes = 56 (best), all different = 1x.
    function scoreDice(uint8[5] memory dice) public pure returns (uint8) {
        uint8[7] memory counts = [0, 0, 0, 0, 0, 0, 0];
        for (uint256 i = 0; i < NUM_DICE; ++i) {
            counts[dice[i]] += 1;
        }
        uint8 bestCount = 0;
        uint8 bestFace = 0;
        for (uint8 face = 6; face >= 1; --face) {
            if (counts[face] > bestCount) {
                bestCount = counts[face];
                bestFace = face;
            }
        }
        return bestCount * 10 + bestFace;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev The only external call is to the immutable, trusted VRF coordinator, and every caller
    ///      is nonReentrant. The request id is unknown until the call returns.
    // slither-disable-next-line reentrancy-benign,reentrancy-no-eth
    function _requestRoll(address player, Turn storage t) private returns (uint256 requestId) {
        requestId = VRF_COORDINATOR.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: VRF_KEY_HASH,
                subId: VRF_SUBSCRIPTION_ID,
                requestConfirmations: VRF_REQUEST_CONFIRMATIONS,
                callbackGasLimit: VRF_CALLBACK_GAS_LIMIT,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: VRF_NATIVE_PAYMENT}))
            })
        );
        t.requestId = requestId;
        requestPlayer[requestId] = player;
    }

    function _finish(address player, Turn storage t) private {
        t.status = TurnStatus.Finished;
        uint256 day = t.day;
        uint8 score = scoreDice(t.dice);
        scoreOf[day][player] = score;

        Day storage d = _days[day];
        if (score > d.topScore) {
            d.topScore = score;
            d.winners = 1;
        } else if (score == d.topScore) {
            d.winners += 1;
        }
        emit TurnFinished(player, day, score);
    }

    function _settle(uint256 day) private {
        Day storage d = _days[day];
        if (d.settled) revert DayAlreadySettled();
        if (block.timestamp < settleableAt(day)) revert DayNotOver();

        uint256 entries = d.entries;
        openEntries -= entries;
        uint256 total = pot + entries;
        uint256 charityCut = 0;
        uint256 perWinner = 0;

        if (d.winners > 0) {
            // Rounding down at each step is intentional: dust stays in the pot (see invariant tests).
            uint256 prizePool = (total * PRIZE_POOL_BPS) / BPS;
            // slither-disable-next-line divide-before-multiply
            charityCut = (prizePool * CHARITY_BPS) / BPS;
            perWinner = (prizePool - charityCut) / d.winners;
            // slither-disable-next-line divide-before-multiply
            uint256 owed = perWinner * d.winners;
            prizeLiability += owed;
            charityBalance += charityCut;
            // Rounding dust from the split stays in the pot.
            pot = total - owed - charityCut;
        } else {
            pot = total;
        }

        d.settled = true;
        d.settledAt = uint64(block.timestamp);
        d.prizePerWinner = uint128(perWinner);
        emit DaySettled(day, d.topScore, d.winners, perWinner, charityCut, pot);
    }
}
