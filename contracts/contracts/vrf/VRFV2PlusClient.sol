// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal copy of Chainlink's VRF v2.5 request types
///         (from chainlink contracts v1.5.0, src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol).
/// @dev Vendored so the game does not inherit VRFConsumerBaseV2Plus, whose owner can
///      swap the coordinator (and therefore choose the dice). Here the coordinator is immutable.
library VRFV2PlusClient {
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function _argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}

/// @notice The single coordinator function the game calls.
interface IVRFCoordinatorV2Plus {
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId);
}
