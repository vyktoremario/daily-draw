// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {
    IRandomnessConsumer,
    IRandomnessProvider
} from "../../src/interfaces/IRandomnessProvider.sol";

/// @notice Test USDC with 6 decimals, open minting, and Circle-style freezing of addresses.
contract MockUSDC is ERC20 {
    constructor() ERC20("Test USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    mapping(address account => bool) public frozen;

    error AccountFrozen(address account);

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFrozen(address account, bool isFrozen) external {
        frozen[account] = isFrozen;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (frozen[from]) revert AccountFrozen(from);
        if (frozen[to]) revert AccountFrozen(to);
        super._update(from, to, value);
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
