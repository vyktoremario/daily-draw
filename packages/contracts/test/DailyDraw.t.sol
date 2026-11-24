// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {DailyDrawBase} from "./DailyDrawBase.sol";

contract DailyDrawTest is DailyDrawBase {
    // ---------------------------------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------------------------------

    function test_OpensTheFirstDrawWithItsOwnCopyOfParams() public view {
        assertEq(game.currentDrawId(), 1);
        DailyDraw.Draw memory d = game.getDraw(1);
        assertEq(uint8(d.status), uint8(DailyDraw.Status.Open));
        assertEq(d.cutoff, firstCutoff);
        assertEq(d.params.ticketPrice, ONE_USDC);
        assertEq(d.params.winnersBps, 6_500);
        assertTrue(game.hasRole(game.PARAMS_ROLE(), admin));
    }

    function test_CannotInitializeTwice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        game.initialize(
            admin, admin, usdc, rng, treasury, buyback, defaultParams(), firstCutoff + 1 days
        );
    }

    function test_RejectsBadParams() public {
        DailyDraw.Params memory p = defaultParams();
        p.teamBps = 1_001; // split no longer adds up to 100%
        vm.prank(admin);
        vm.expectRevert(DailyDraw.InvalidParams.selector);
        game.setParams(p);
    }

    // ---------------------------------------------------------------------------------------------
    // Buying
    // ---------------------------------------------------------------------------------------------

    function test_BuysOneTicketWithTheFee() public {
        uint256 before = usdc.balanceOf(alice);
        buy(alice, nums(42), address(0));

        assertEq(before - usdc.balanceOf(alice), 1_100_000); // $1 + 10% fee
        assertEq(usdc.balanceOf(address(game)), 1_100_000);
        DailyDraw.Draw memory d = game.getDraw(1);
        assertEq(d.sales, ONE_USDC);
        assertEq(d.fees, 100_000);
        assertEq(d.ticketCount, 1);
        assertEq(game.ticketsPerNumber(1, 42), 1);
        assertEq(game.ticketsOf(1, alice, 42), 1);
        assertEq(game.lastPlayed(alice), START);
    }

    function test_BuysEachBundleSize() public {
        buy(alice, many(2, 0), address(0));
        buy(alice, many(5, 10), address(0));
        buy(alice, many(10, 20), address(0));
        assertEq(game.ticketsBoughtBy(1, alice), 17);
        assertEq(game.getDraw(1).sales, 17 * ONE_USDC);
        (uint256 price, uint256 fee) = game.quote(1, 10);
        assertEq(price + fee, 11 * ONE_USDC);
    }

    function test_SameNumberTwiceCountsTwice() public {
        uint16[] memory n = new uint16[](2);
        (n[0], n[1]) = (7, 7);
        buy(alice, n, address(0));
        assertEq(game.ticketsPerNumber(1, 7), 2);
        assertEq(game.ticketsOf(1, alice, 7), 2);
    }

    function test_RevertWhen_BundleSizeNotAllowed() public {
        for (uint256 c = 0; c <= 12; ++c) {
            if (c == 1 || c == 2 || c == 5 || c == 10) continue;
            vm.prank(alice);
            vm.expectRevert(abi.encodeWithSelector(DailyDraw.InvalidBundle.selector, c));
            game.buyTickets(1, many(c, 0), address(0));
        }
    }

    function test_RevertWhen_NumberOutOfRange() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.InvalidNumber.selector, 100));
        game.buyTickets(1, nums(100), address(0));
    }

    function test_RevertWhen_OverTheWalletLimit() public {
        buy(alice, many(10, 0), address(0));
        buy(alice, many(10, 10), address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.WalletLimitReached.selector, 20));
        game.buyTickets(1, nums(1), address(0));
    }

    function test_RevertWhen_BuyingAtOrAfterCutoff() public {
        vm.warp(firstCutoff);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.SalesClosed.selector, 1, firstCutoff));
        game.buyTickets(1, nums(1), address(0));
    }

    function test_RevertWhen_DrawNotOpen() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotOpen.selector, 2));
        game.buyTickets(2, nums(1), address(0));
    }

    // ---------------------------------------------------------------------------------------------
    // Referrers
    // ---------------------------------------------------------------------------------------------

    function test_SetsReferrerOnFirstPlay() public {
        vm.expectEmit(true, true, false, false);
        emit DailyDraw.ReferrerSet(bob, alice);
        buy(bob, nums(1), alice);
        assertEq(game.referrerOf(bob), alice);
    }

    function test_ReferrerCannotBeChangedLater() public {
        buy(bob, nums(1), alice);
        buy(bob, nums(2), carol);
        assertEq(game.referrerOf(bob), alice);
    }

    function test_ReferrerOnlyOnFirstEverPurchase() public {
        buy(bob, nums(1), address(0));
        buy(bob, nums(2), alice);
        assertEq(game.referrerOf(bob), address(0));
    }

    function test_CannotReferYourself() public {
        buy(bob, nums(1), bob);
        assertEq(game.referrerOf(bob), address(0));
    }

    // ---------------------------------------------------------------------------------------------
    // Closing and drawing
    // ---------------------------------------------------------------------------------------------

    function test_RevertWhen_ClosingBeforeCutoff() public {
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.CutoffNotReached.selector, 1, firstCutoff));
        game.closeDraw(1);
    }

    function test_AnyoneCanCloseAfterCutoffAndTheNextDrawOpens() public {
        buy(alice, nums(42), address(0));
        vm.warp(firstCutoff);
        vm.prank(carol);
        game.closeDraw(1);

        DailyDraw.Draw memory d = game.getDraw(1);
        assertEq(uint8(d.status), uint8(DailyDraw.Status.Closed));
        assertEq(d.requestId, 1);
        assertEq(game.drawForRequest(1), 1);

        assertEq(game.currentDrawId(), 2);
        DailyDraw.Draw memory next = game.getDraw(2);
        assertEq(uint8(next.status), uint8(DailyDraw.Status.Open));
        assertEq(next.cutoff, firstCutoff + 1 days);
        buy(bob, nums(1), address(0)); // sales continue for tomorrow
    }

    function test_SkipsMissedDaysWhenClosingLate() public {
        vm.warp(firstCutoff + 3 days + 5 hours);
        game.closeDraw(1);
        assertEq(game.getDraw(2).cutoff, firstCutoff + 4 days);
    }

    function test_DrawsTheWinningNumberFromRandomness() public {
        buy(alice, nums(42), address(0));
        buy(bob, nums(42), address(0));
        buy(carol, nums(7), address(0));
        vm.warp(firstCutoff);
        game.closeDraw(1);

        vm.expectEmit(true, false, false, true);
        emit DailyDraw.DrawDrawn(1, 42, 2);
        rng.fulfill(1, 1_000_042); // 1_000_042 mod 100 = 42

        DailyDraw.Draw memory d = game.getDraw(1);
        assertEq(uint8(d.status), uint8(DailyDraw.Status.Settled)); // settled in the same call
        assertEq(d.winningNumber, 42);
        assertEq(d.winningTickets, 2);
    }

    function test_RevertWhen_RandomnessNotFromProvider() public {
        vm.warp(firstCutoff);
        game.closeDraw(1);
        vm.prank(alice);
        vm.expectRevert(DailyDraw.NotRandomnessProvider.selector);
        game.fulfillRandomness(1, 42);
    }

    function test_RevertWhen_FulfilledTwice() public {
        vm.warp(firstCutoff);
        game.closeDraw(1);
        rng.fulfill(1, 42);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.UnknownRequest.selector, 1));
        rng.fulfill(1, 7);
        assertEq(game.getDraw(1).winningNumber, 42);
    }

    function test_RevertWhen_UnknownRequest() public {
        vm.prank(address(rng));
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.UnknownRequest.selector, 99));
        game.fulfillRandomness(99, 42);
    }

    function test_ParamsChangesOnlyAffectFutureDraws() public {
        DailyDraw.Params memory p = defaultParams();
        p.ticketPrice = uint128(2 * ONE_USDC);
        vm.prank(admin);
        game.setParams(p);
        assertEq(game.getDraw(1).params.ticketPrice, ONE_USDC);

        vm.warp(firstCutoff);
        game.closeDraw(1);
        assertEq(game.getDraw(2).params.ticketPrice, 2 * ONE_USDC);
    }

    function test_OnlyRolesCanAdminister() public {
        bytes32 paramsRole = game.PARAMS_ROLE();
        bytes32 upgraderRole = game.UPGRADER_ROLE();
        DailyDraw.Params memory p = defaultParams();
        DailyDraw newImpl = new DailyDraw();

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, paramsRole
            )
        );
        vm.prank(alice);
        game.setParams(p);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, upgraderRole
            )
        );
        vm.prank(alice);
        game.upgradeToAndCall(address(newImpl), "");
    }

    // ---------------------------------------------------------------------------------------------
    // Fuzz
    // ---------------------------------------------------------------------------------------------

    function testFuzz_WinningNumberAlwaysInRange(uint256 value) public {
        vm.warp(firstCutoff);
        game.closeDraw(1);
        rng.fulfill(1, value);
        assertLt(game.getDraw(1).winningNumber, 100);
        assertEq(game.getDraw(1).winningNumber, value % 100);
    }

    function testFuzz_PaymentsAddUp(uint8 bundleIndex, uint16 start) public {
        uint256[4] memory sizes = [uint256(1), 2, 5, 10];
        uint256 count = sizes[bundleIndex % 4];
        buy(alice, many(count, start), address(0));
        DailyDraw.Draw memory d = game.getDraw(1);
        assertEq(usdc.balanceOf(address(game)), uint256(d.sales) + d.fees);
        assertEq(d.fees, d.sales / 10);
        assertEq(d.ticketCount, count);
    }
}
