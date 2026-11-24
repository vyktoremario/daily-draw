// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/// @notice A source of verifiable randomness, wrapped so DailyDraw doesn't depend on one vendor.
/// @dev An adapter per chain (Chainlink VRF, or another verifiable random function) implements this.
///      The provider must later call `IRandomnessConsumer(consumer).fulfillRandomness(requestId, value)`
///      exactly once per request, and only after checking the randomness proof.
interface IRandomnessProvider {
    /// @return requestId An id unique to this provider, echoed back on fulfilment.
    function requestRandomness() external returns (uint256 requestId);
}

interface IRandomnessConsumer {
    function fulfillRandomness(uint256 requestId, uint256 randomness) external;
}
