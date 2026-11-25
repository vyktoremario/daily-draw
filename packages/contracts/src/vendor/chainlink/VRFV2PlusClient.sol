// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

// Vendored from smartcontractkit/chainlink (tag contracts-v1.3.0),
// contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol. Copied instead of adding the whole
// Chainlink contracts package as a dependency: this library and the two-function coordinator
// interface next to it are all the VRF adapter needs.
library VRFV2PlusClient {
    // extraArgs will evolve to support new features
    bytes4 public constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

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

    function _argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory bts) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}
