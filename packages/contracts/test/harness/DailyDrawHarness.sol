// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {DailyDraw} from "../../src/DailyDraw.sol";

/// @notice DailyDraw with setters to place a draw in any state, so the shared settlement vectors
///         (whose sales aren't always whole tickets) can run through the real settlement and claims.
///         Tests only; the caller must mint the matching USDC to the contract.
contract DailyDrawHarness is DailyDraw {
    function seedSales(uint256 drawId, uint128 sales) external {
        _draws[drawId].sales = sales;
    }

    function seedRollover(uint256 amount) external {
        rollover = amount;
    }

    /// @dev One ticket on `number` for `player` in `drawId`, with an optional referrer.
    function seedTicket(uint256 drawId, address player, uint16 number, address referrer) external {
        ++ticketsPerNumber[drawId][number];
        ++ticketsOf[drawId][player][number];
        ++ticketsBoughtBy[drawId][player];
        ++_draws[drawId].ticketCount;
        if (referrer != address(0)) referrerOf[player] = referrer;
        _recordPlay(player, drawId);
    }

    function seedPlay(address player, uint256 drawId) external {
        _recordPlay(player, drawId);
    }
}
