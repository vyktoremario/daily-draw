// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {DailyDrawBase} from "./DailyDrawBase.sol";
import {MockRandomness} from "./mocks/Mocks.sol";

/// @notice Void and refund, unclaimed-prize sweep, pause, and role checks (#27).
contract SafetyTest is DailyDrawBase {
    /// @dev Closes the current draw at its cutoff without fulfilling its randomness.
    function closeOnly() internal returns (uint256 drawId) {
        drawId = game.currentDrawId();
        vm.warp(game.getDraw(drawId).cutoff);
        game.closeDraw(drawId);
    }

    function voidAsAdmin(uint256 drawId) internal {
        vm.prank(admin);
        game.voidDraw(drawId, "randomness provider down");
    }

    // ---------------------------------------------------------------------------------------------
    // Void
    // ---------------------------------------------------------------------------------------------

    function test_AdminVoidsAClosedDrawStraightAway() public {
        buy(alice, nums(7), address(0));
        uint256 drawId = closeOnly();

        vm.expectEmit(true, true, false, true);
        emit DailyDraw.DrawVoided(drawId, admin, "provider down");
        vm.prank(admin);
        game.voidDraw(drawId, "provider down");

        assertEq(uint8(game.getDraw(drawId).status), uint8(DailyDraw.Status.Voided));
        assertEq(game.currentDrawId(), drawId + 1); // the next draw is already open
        assertSolvent();
    }

    function test_AnyoneCanVoidAfter24HoursButNotBefore() public {
        buy(alice, nums(7), address(0));
        uint256 drawId = closeOnly();
        uint256 allowedFrom = block.timestamp + 24 hours;

        vm.warp(allowedFrom - 1);
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(DailyDraw.VoidTooEarly.selector, drawId, allowedFrom)
        );
        game.voidDraw(drawId, "no randomness");

        vm.warp(allowedFrom);
        vm.prank(carol);
        game.voidDraw(drawId, "no randomness");
        assertEq(uint8(game.getDraw(drawId).status), uint8(DailyDraw.Status.Voided));
        assertSolvent();
    }

    function test_TheVoidClockStartsAtCloseNotCutoff() public {
        uint256 drawId = game.currentDrawId();
        vm.warp(firstCutoff + 20 hours); // closed late
        game.closeDraw(drawId);
        vm.warp(firstCutoff + 24 hours);
        vm.expectRevert(
            abi.encodeWithSelector(DailyDraw.VoidTooEarly.selector, drawId, firstCutoff + 44 hours)
        );
        game.voidDraw(drawId, "");
    }

    function test_RevertWhen_VoidingADrawThatIsNotClosed() public {
        // Open
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotClosed.selector, 1));
        game.voidDraw(1, "");

        // Settled
        buy(alice, nums(7), address(0));
        closeAndDraw(7);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotClosed.selector, 1));
        game.voidDraw(1, "");

        // Already voided
        uint256 drawId = closeOnly();
        voidAsAdmin(drawId);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotClosed.selector, drawId));
        game.voidDraw(drawId, "");
    }

    function test_LateRandomnessAfterVoidDoesNothing() public {
        buy(alice, nums(7), address(0));
        uint256 drawId = closeOnly();
        voidAsAdmin(drawId);
        uint256 requestId = game.getDraw(drawId).requestId;

        uint256 treasuryBefore = game.treasuryBalance();
        uint256 rolloverBefore = game.rollover();
        vm.expectEmit(true, false, false, true);
        emit DailyDraw.LateRandomnessIgnored(drawId, requestId);
        rng.fulfill(requestId, 7); // does not revert

        DailyDraw.Draw memory d = game.getDraw(drawId);
        assertEq(uint8(d.status), uint8(DailyDraw.Status.Voided));
        assertEq(d.winningNumber, 0);
        assertEq(d.settledAt, 0);
        assertEq(game.treasuryBalance(), treasuryBefore);
        assertEq(game.rollover(), rolloverBefore);
        assertEq(game.unclaimedWinnings(), 0);
        assertSolvent();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotSettled.selector, drawId));
        game.claim(drawId, nums(7));
    }

    function test_VoidedDrawLeavesRolloverForTheNextDraw() public {
        buy(alice, many(10, 0), address(0));
        closeAndDraw(50); // nobody wins: 10 USDC rolls over
        assertEq(game.rollover(), 10 * ONE_USDC);

        buy(bob, many(5, 10), address(0)); // draw 2: voided
        uint256 voided = closeOnly();
        voidAsAdmin(voided);
        assertEq(game.rollover(), 10 * ONE_USDC);
        assertEq(game.treasuryBalance(), feeOn(10 * ONE_USDC)); // only draw 1's fees
        assertSolvent();

        buy(carol, nums(42), address(0)); // draw 3: pool = 1 + 10 rollover, bob's 5 not included
        uint256 drawId = closeAndDraw(42);
        assertEq(game.getDraw(drawId).pool, 11 * ONE_USDC);
        // + 10% team + carol's fee
        assertEq(game.treasuryBalance(), feeOn(10 * ONE_USDC) + 1_100_000 + feeOn(ONE_USDC));
        assertSolvent();

        vm.prank(bob);
        game.refund(voided, many(5, 10));
        assertSolvent();
    }

    // ---------------------------------------------------------------------------------------------
    // Refund
    // ---------------------------------------------------------------------------------------------

    function test_RefundsExactlyWhatEachWalletPaid() public {
        buy(alice, nums(7), address(0));
        buy(alice, many(5, 20), address(0));
        buy(bob, same(10, 33), alice);
        buy(carol, many(2, 98), address(0)); // 98, 99
        uint256 drawId = closeOnly();
        voidAsAdmin(drawId);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);
        uint256 carolBefore = usdc.balanceOf(carol);

        uint256 ticket = ONE_USDC + feeOn(ONE_USDC); // price + fee
        vm.expectEmit(true, true, false, true);
        emit DailyDraw.Refunded(drawId, alice, 6, 6 * ticket);
        vm.prank(alice);
        game.refund(drawId, many(30, 0)); // everything from 00 to 29: holds 07 and 20..24
        assertSolvent();

        vm.prank(bob);
        game.refund(drawId, nums(33)); // ten tickets on one number
        assertSolvent();

        vm.prank(carol);
        game.refund(drawId, nums(98)); // one at a time works too
        vm.prank(carol);
        game.refund(drawId, nums(99));
        assertSolvent();

        assertEq(usdc.balanceOf(alice) - aliceBefore, 6 * ticket);
        assertEq(usdc.balanceOf(bob) - bobBefore, 10 * ticket);
        assertEq(usdc.balanceOf(carol) - carolBefore, 2 * ticket);
        // Every wallet is back where it started.
        assertEq(usdc.balanceOf(alice), 1_000 * ONE_USDC);
        assertEq(usdc.balanceOf(bob), 1_000 * ONE_USDC);
        assertEq(usdc.balanceOf(carol), 1_000 * ONE_USDC);

        DailyDraw.Draw memory d = game.getDraw(drawId);
        assertEq(d.refunded, uint256(d.sales) + d.fees);
        assertEq(usdc.balanceOf(address(game)), 0);
    }

    function test_RevertWhen_RefundingTwice() public {
        buy(alice, many(2, 7), address(0)); // 07, 08
        uint256 drawId = closeOnly();
        voidAsAdmin(drawId);

        vm.prank(alice);
        game.refund(drawId, nums(7));

        vm.prank(alice);
        vm.expectRevert(DailyDraw.NothingToRefund.selector);
        game.refund(drawId, nums(7));

        // Listing a number twice in one call refunds it once.
        uint16[] memory twice = same(2, 8);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        game.refund(drawId, twice);
        assertEq(usdc.balanceOf(alice) - before, ONE_USDC + feeOn(ONE_USDC));

        vm.prank(alice);
        vm.expectRevert(DailyDraw.NothingToRefund.selector);
        game.refund(drawId, many(2, 7));
        assertSolvent();
    }

    function test_RevertWhen_RefundingWithoutTickets() public {
        buy(alice, nums(7), address(0));
        uint256 drawId = closeOnly();
        voidAsAdmin(drawId);
        vm.prank(bob);
        vm.expectRevert(DailyDraw.NothingToRefund.selector);
        game.refund(drawId, nums(7));
    }

    function test_RevertWhen_RefundingADrawThatIsNotVoided() public {
        buy(alice, nums(7), address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotVoided.selector, 1));
        game.refund(1, nums(7)); // open

        closeOnly();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotVoided.selector, 1));
        game.refund(1, nums(7)); // closed, waiting for randomness

        rng.fulfill(game.getDraw(1).requestId, 7);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotVoided.selector, 1));
        game.refund(1, nums(7)); // settled
    }

    function test_RejectsParamsWhoseFeeRounds() public {
        DailyDraw.Params memory p = defaultParams();
        p.ticketPrice = 1_000_001; // 2% of it isn't a whole unit
        vm.prank(admin);
        vm.expectRevert(DailyDraw.InvalidParams.selector);
        game.setParams(p);
    }

    // ---------------------------------------------------------------------------------------------
    // Sweep
    // ---------------------------------------------------------------------------------------------

    /// @dev Draw 1: bob (referred by alice) and carol both on 42, plus 8 losing tickets; pool 10.
    function settleTwoWinners() internal returns (uint256 drawId) {
        buy(alice, many(5, 0), address(0));
        buy(bob, nums(42), alice);
        buy(carol, nums(42), address(0));
        buy(carol, same(2, 1), address(0));
        buy(bob, nums(3), alice);
        drawId = closeAndDraw(42);
        // prize 10 * 65% / 2 = 3.25, share 10 * 20% / 2 = 1
        assertEq(game.getDraw(drawId).prizePerTicket, 3_250_000);
        assertEq(game.getDraw(drawId).referralSharePerTicket, ONE_USDC);
    }

    function test_RevertWhen_SweepingBefore30Days() public {
        uint256 drawId = settleTwoWinners();
        uint256 allowedFrom = uint256(game.getDraw(drawId).settledAt) + 30 days;
        vm.warp(allowedFrom - 1);
        vm.expectRevert(
            abi.encodeWithSelector(DailyDraw.SweepTooEarly.selector, drawId, allowedFrom)
        );
        game.sweepUnclaimed(drawId);
    }

    function test_SweepMovesUnclaimedPrizesIntoTheNextSettlement() public {
        uint256 drawId = settleTwoWinners();
        claimAs(bob, drawId, 42); // carol never claims
        uint256 rolloverBefore = game.rollover();
        assertEq(game.unclaimedWinnings(), 4_250_000);

        vm.warp(uint256(game.getDraw(drawId).settledAt) + 30 days);
        vm.expectEmit(true, false, false, true);
        emit DailyDraw.UnclaimedSwept(drawId, 1, 4_250_000);
        vm.prank(alice); // anyone
        game.sweepUnclaimed(drawId);

        assertEq(uint8(game.getDraw(drawId).status), uint8(DailyDraw.Status.Swept));
        assertEq(game.unclaimedWinnings(), 0);
        assertEq(game.rollover(), rolloverBefore + 4_250_000);
        assertSolvent();

        // Claims for the swept draw revert, and its claimable view shows nothing.
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotSettled.selector, drawId));
        game.claim(drawId, nums(42));
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotSettled.selector, drawId));
        game.claimFor(carol, drawId);
        (uint256 tickets,) = game.claimable(drawId, carol);
        assertEq(tickets, 0);

        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotSettled.selector, drawId));
        game.sweepUnclaimed(drawId);

        // The next settlement's pool includes it.
        uint256 rollover = game.rollover();
        // Draw 2's cutoff passed during the 30 days with no tickets: it settles as a pure rollover.
        uint256 empty = closeAndDraw(11);
        assertEq(game.getDraw(empty).pool, rollover);
        assertEq(game.rollover(), rollover);
        buy(bob, nums(11), address(0));
        uint256 next = closeAndDraw(11);
        assertEq(game.getDraw(next).pool, ONE_USDC + rollover);
        assertSolvent();
    }

    function test_SweepAfterEveryoneClaimedReverts() public {
        uint256 drawId = settleTwoWinners();
        claimAs(bob, drawId, 42);
        claimAs(carol, drawId, 42);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.NothingToSweep.selector, drawId));
        game.sweepUnclaimed(drawId);
        assertSolvent();
    }

    function test_SweepUsesTheDrawsOwnClaimWindow() public {
        DailyDraw.Params memory p = defaultParams();
        p.unclaimedPrizeDays = 7;
        vm.prank(admin);
        game.setParams(p); // applies from draw 2

        uint256 first = settleTwoWinners(); // draw 1 keeps 30 days
        buy(bob, nums(42), address(0));
        uint256 second = closeAndDraw(42); // draw 2 has 7
        uint256 settled = game.getDraw(second).settledAt;

        vm.warp(settled + 7 days);
        game.sweepUnclaimed(second);
        uint256 firstAllowed = uint256(game.getDraw(first).settledAt) + 30 days;
        vm.expectRevert(
            abi.encodeWithSelector(DailyDraw.SweepTooEarly.selector, first, firstAllowed)
        );
        game.sweepUnclaimed(first);
        assertSolvent();
    }

    function test_RejectsZeroClaimWindow() public {
        DailyDraw.Params memory p = defaultParams();
        p.unclaimedPrizeDays = 0;
        vm.prank(admin);
        vm.expectRevert(DailyDraw.InvalidParams.selector);
        game.setParams(p);
    }

    // ---------------------------------------------------------------------------------------------
    // Pause
    // ---------------------------------------------------------------------------------------------

    function test_PauseBlocksBuyingAndClosing() public {
        vm.prank(admin);
        game.pause();
        assertTrue(game.paused());

        vm.prank(alice);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        game.buyTickets(1, nums(7), address(0));

        vm.warp(firstCutoff);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        game.closeDraw(1);

        vm.prank(admin);
        game.unpause();
        game.closeDraw(1);
        buy(alice, nums(7), address(0));
        assertSolvent();
    }

    function test_PauseKeepsClaimsRefundsAndWithdrawalsWorking() public {
        // Draw 1 settles with bob (referred by alice) winning.
        buy(alice, nums(3), address(0));
        buy(bob, nums(42), alice);
        uint256 won = closeAndDraw(42);
        // Draw 2 closes and waits for randomness; draw 3 settles with carol unclaimed.
        buy(carol, nums(5), address(0));
        uint256 stuck = closeOnly();
        buy(carol, nums(9), address(0));
        uint256 unclaimed = closeAndDraw(9);

        vm.prank(admin);
        game.pause();

        claimAs(bob, won, 42);
        vm.prank(alice);
        game.claimReferral();
        game.withdrawTreasury();
        game.withdrawBuyback();
        assertSolvent();

        // Voiding and refunds work while paused; so does a late randomness callback.
        // Draw 3 closed a day after draw 2, so draw 2 has waited 24 hours: anyone may void it.
        assertEq(block.timestamp, game.getDraw(stuck).closedAt + 24 hours);
        game.voidDraw(stuck, "no randomness");
        vm.prank(carol);
        game.refund(stuck, nums(5));
        assertSolvent();

        vm.warp(game.getDraw(unclaimed).settledAt + 30 days);
        game.sweepUnclaimed(unclaimed);
        assertSolvent();
    }

    function test_RandomnessStillSettlesWhilePaused() public {
        buy(bob, nums(42), address(0));
        uint256 drawId = closeOnly();
        vm.prank(admin);
        game.pause();
        rng.fulfill(game.getDraw(drawId).requestId, 42);
        assertEq(uint8(game.getDraw(drawId).status), uint8(DailyDraw.Status.Settled));
        claimAs(bob, drawId, 42);
        assertSolvent();
    }

    function test_OnlyPauserCanPause() public {
        bytes32 role = game.PAUSER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, role
            )
        );
        vm.prank(alice);
        game.pause();

        vm.prank(admin);
        game.pause();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, role
            )
        );
        vm.prank(alice);
        game.unpause();
    }

    // ---------------------------------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------------------------------

    function test_TimelockedRolesCannotBeGrantedByTheAdminRole() public {
        address multisig = makeAddr("safe");
        address timelock = makeAddr("timelock");
        game = DailyDraw(
            address(
                new ERC1967Proxy(
                    address(new DailyDraw()),
                    abi.encodeCall(
                        DailyDraw.initialize,
                        (
                            multisig,
                            timelock,
                            usdc,
                            rng,
                            treasury,
                            buyback,
                            defaultParams(),
                            firstCutoff
                        )
                    )
                )
            )
        );
        bytes32 paramsRole = game.PARAMS_ROLE();
        bytes32 upgraderRole = game.UPGRADER_ROLE();
        assertEq(game.getRoleAdmin(paramsRole), upgraderRole);
        assertEq(game.getRoleAdmin(upgraderRole), upgraderRole);
        assertFalse(game.hasRole(paramsRole, multisig));
        assertTrue(game.hasRole(paramsRole, timelock));

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, multisig, upgraderRole
            )
        );
        vm.prank(multisig);
        game.grantRole(paramsRole, multisig);

        // Swapping the randomness provider is timelocked too.
        MockRandomness other = new MockRandomness();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, multisig, paramsRole
            )
        );
        vm.prank(multisig);
        game.setRandomnessProvider(other);
        vm.prank(timelock);
        game.setRandomnessProvider(other);
        assertEq(address(game.randomness()), address(other));
    }
}
