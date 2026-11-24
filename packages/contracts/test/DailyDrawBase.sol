// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {MockRandomness, MockUSDC} from "./mocks/Mocks.sol";

/// @notice Deployment and helpers shared by the DailyDraw test suites.
abstract contract DailyDrawBase is Test {
    DailyDraw internal game;
    MockUSDC internal usdc;
    MockRandomness internal rng;

    address internal admin = makeAddr("multisig");
    address internal treasury = makeAddr("treasury");
    address internal buyback = makeAddr("buyback");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint64 internal constant START = 1_800_000_000;
    uint64 internal firstCutoff = START + 12 hours;
    uint256 internal constant ONE_USDC = 1_000_000;

    function defaultParams() internal pure returns (DailyDraw.Params memory) {
        return DailyDraw.Params({
            ticketPrice: uint128(ONE_USDC),
            feeBps: 1_000,
            numberRange: 100,
            winnersBps: 6_500,
            teamBps: 1_000,
            buybackBps: 500,
            referrersBps: 2_000,
            maxTicketsPerWallet: 20,
            drawInterval: 1 days,
            referrerActiveDays: 30,
            unclaimedPrizeDays: 30
        });
    }

    function setUp() public virtual {
        vm.warp(START);
        usdc = new MockUSDC();
        rng = new MockRandomness();
        game = deploy(address(new DailyDraw()));
        bytes32 keeperRole = game.KEEPER_ROLE();
        vm.prank(admin);
        game.grantRole(keeperRole, keeper);

        for (uint256 i; i < 3; ++i) {
            fund([alice, bob, carol][i]);
        }
    }

    function deploy(address impl) internal returns (DailyDraw) {
        bytes memory init = abi.encodeCall(
            DailyDraw.initialize,
            (admin, admin, usdc, rng, treasury, buyback, defaultParams(), firstCutoff)
        );
        return DailyDraw(address(new ERC1967Proxy(impl, init)));
    }

    function fund(address p) internal {
        usdc.mint(p, 1_000 * ONE_USDC);
        vm.prank(p);
        usdc.approve(address(game), type(uint256).max);
    }

    function nums(uint16 a) internal pure returns (uint16[] memory n) {
        n = new uint16[](1);
        n[0] = a;
    }

    function many(uint256 count, uint16 start) internal pure returns (uint16[] memory n) {
        n = new uint16[](count);
        for (uint256 i; i < count; ++i) {
            n[i] = uint16((start + i) % 100);
        }
    }

    function same(uint256 count, uint16 number) internal pure returns (uint16[] memory n) {
        n = new uint16[](count);
        for (uint256 i; i < count; ++i) {
            n[i] = number;
        }
    }

    function buy(address player, uint16[] memory numbers, address referrer) internal {
        uint256 drawId = game.currentDrawId(); // read first: vm.prank applies to the next call only
        vm.prank(player);
        game.buyTickets(drawId, numbers, referrer);
    }

    /// @dev Closes the current draw at its cutoff and fulfils its randomness with `winning`.
    function closeAndDraw(uint16 winning) internal returns (uint256 drawId) {
        drawId = game.currentDrawId();
        DailyDraw.Draw memory d = game.getDraw(drawId);
        if (block.timestamp < d.cutoff) vm.warp(d.cutoff);
        game.closeDraw(drawId);
        rng.fulfill(game.getDraw(drawId).requestId, winning);
    }

    function claimAs(address player, uint256 drawId, uint16 number) internal {
        vm.prank(player);
        game.claim(drawId, nums(number));
    }

    /// @dev Everything the contract owes: unsettled draws' sales and fees (less refunds), the rollover, unclaimed
    ///      prizes and referral shares, referrers' balances, and the treasury and buy-back credits.
    function owed() internal view returns (uint256 total) {
        uint256 last = game.currentDrawId();
        for (uint256 id = 1; id <= last; ++id) {
            DailyDraw.Draw memory d = game.getDraw(id);
            if (d.status == DailyDraw.Status.Settled || d.status == DailyDraw.Status.Swept) {
                continue;
            }
            // Open, closed or voided: its money is still held for it, less any refunds.
            total += uint256(d.sales) + d.fees - d.refunded;
        }
        total += game.rollover() + game.unclaimedWinnings() + game.totalReferralBalances()
        + game.treasuryBalance() + game.buybackBalance();
    }

    function assertSolvent() internal view {
        assertEq(usdc.balanceOf(address(game)), owed(), "balance != owed");
    }
}
