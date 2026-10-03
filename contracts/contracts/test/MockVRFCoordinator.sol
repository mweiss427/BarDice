// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {VRFV2PlusClient} from "../vrf/VRFV2PlusClient.sol";

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @notice Test/dev stand-in for Chainlink's VRF v2.5 coordinator.
/// @dev Tests (and the local auto-fulfill script) choose the random word, so dice are deterministic.
contract MockVRFCoordinator {
    struct Request {
        address consumer;
        uint32 callbackGasLimit;
        bool fulfilled;
    }

    uint256 public nextRequestId = 1;
    /// @notice When true (default), a reverting/out-of-gas consumer callback fails the fulfil tx so tests notice.
    ///         The real coordinator never reverts here; set false to simulate that.
    bool public strict = true;
    mapping(uint256 => Request) public requests;
    VRFV2PlusClient.RandomWordsRequest public lastRequest;

    event RandomWordsRequested(uint256 indexed requestId, address indexed consumer);
    event RandomWordsFulfilled(uint256 indexed requestId, bool success);

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = Request(msg.sender, req.callbackGasLimit, false);
        lastRequest = req;
        emit RandomWordsRequested(requestId, msg.sender);
    }

    /// @notice Deliver `word` to the consumer with the same gas cap the real coordinator would use.
    function fulfill(uint256 requestId, uint256 word) public returns (bool success) {
        Request storage r = requests[requestId];
        require(r.consumer != address(0) && !r.fulfilled, "bad request");
        r.fulfilled = true;
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        (success,) = r.consumer.call{gas: r.callbackGasLimit}(
            abi.encodeCall(IVRFConsumer.rawFulfillRandomWords, (requestId, words))
        );
        require(success || !strict, "consumer callback failed");
        emit RandomWordsFulfilled(requestId, success);
    }

    function setStrict(bool strict_) external {
        strict = strict_;
    }

    /// @notice Build a word that produces exactly these dice (faces 1..6) for every un-held die.
    function wordFor(uint8[5] calldata faces) public pure returns (uint256 word) {
        for (uint256 i = 0; i < 5; ++i) {
            require(faces[i] >= 1 && faces[i] <= 6, "face");
            word |= uint256(faces[i] - 1) << (32 * i);
        }
    }

    function fulfillDice(uint256 requestId, uint8[5] calldata faces) external returns (bool) {
        return fulfill(requestId, wordFor(faces));
    }
}
