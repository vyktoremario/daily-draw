// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IRandomnessConsumer, IRandomnessProvider} from "../interfaces/IRandomnessProvider.sol";

/// @notice Randomness provider for local chains and testnet demos: the operator chooses the answer
///         and triggers it by hand (`pnpm chain draw 42`). NOT random and NOT verifiable; production
///         uses a VRF adapter (#24).
contract DevRandomness is IRandomnessProvider {
    address public immutable operator;
    uint256 public nextRequestId = 1;
    /// @notice The most recent request, so a dev script can answer it without reading events.
    uint256 public lastRequestId;
    mapping(uint256 requestId => address consumer) public consumerOf;
    mapping(uint256 requestId => bool) public fulfilled;

    event RandomnessRequested(uint256 indexed requestId, address indexed consumer);
    event RandomnessFulfilled(uint256 indexed requestId, uint256 value);

    error NotOperator();
    error UnknownRequest(uint256 requestId);
    error AlreadyFulfilled(uint256 requestId);

    constructor(address operator_) {
        if (operator_ == address(0)) revert NotOperator();
        operator = operator_;
    }

    function requestRandomness() external returns (uint256 requestId) {
        requestId = nextRequestId++;
        lastRequestId = requestId;
        consumerOf[requestId] = msg.sender;
        emit RandomnessRequested(requestId, msg.sender);
    }

    /// @notice Answer a request with `value` (the game takes `value % numberRange`).
    function fulfill(uint256 requestId, uint256 value) external {
        if (msg.sender != operator) revert NotOperator();
        address consumer = consumerOf[requestId];
        if (consumer == address(0)) revert UnknownRequest(requestId);
        if (fulfilled[requestId]) revert AlreadyFulfilled(requestId);
        fulfilled[requestId] = true;
        emit RandomnessFulfilled(requestId, value);
        IRandomnessConsumer(consumer).fulfillRandomness(requestId, value);
    }
}
