// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {
    IRandomnessConsumer,
    IRandomnessProvider
} from "../../src/interfaces/IRandomnessProvider.sol";

/// @notice Test USDC with 6 decimals and open minting.
contract MockUSDC is ERC20 {
    constructor() ERC20("Test USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Randomness provider whose answers the test chooses.
contract MockRandomness is IRandomnessProvider {
    uint256 public nextRequestId = 1;
    mapping(uint256 requestId => address consumer) public consumerOf;

    function requestRandomness() external returns (uint256 requestId) {
        requestId = nextRequestId++;
        consumerOf[requestId] = msg.sender;
    }

    function fulfill(uint256 requestId, uint256 value) external {
        IRandomnessConsumer(consumerOf[requestId]).fulfillRandomness(requestId, value);
    }
}
