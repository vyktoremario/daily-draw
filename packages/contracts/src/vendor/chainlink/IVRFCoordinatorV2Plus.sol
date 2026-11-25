// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {VRFV2PlusClient} from "./VRFV2PlusClient.sol";

/// @notice The one call we make on Chainlink's VRF v2.5 coordinator. A minimal slice of
///         smartcontractkit/chainlink (tag contracts-v1.3.0),
///         contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol.
interface IVRFCoordinatorV2Plus {
    /// @notice Request a set of random words. The coordinator later calls
    ///         `rawFulfillRandomWords(requestId, randomWords)` on the caller (the consumer), which
    ///         must be registered on subscription `req.subId`.
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        returns (uint256 requestId);
}
