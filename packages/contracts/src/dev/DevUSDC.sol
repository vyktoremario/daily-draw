// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test USDC (6 decimals) with a public faucet. Local chains and testnets only: it has no
///         value, and anyone can mint it.
contract DevUSDC is ERC20 {
    /// @notice What one `faucet()` call mints: $100.
    uint256 public constant FAUCET_AMOUNT = 100e6;
    /// @notice Largest `mint` in one call: $10,000.
    uint256 public constant MAX_MINT = 10_000e6;

    error MintTooLarge(uint256 amount, uint256 max);

    constructor() ERC20("Test USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint $100 of test USDC to the caller.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Mint test USDC to anyone (dev scripts seed wallets with this).
    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge(amount, MAX_MINT);
        _mint(to, amount);
    }
}
