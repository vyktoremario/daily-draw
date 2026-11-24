// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {DailyDrawBase} from "./DailyDrawBase.sol";
import {MockUSDC} from "./mocks/Mocks.sol";

/// @notice Settlement (65/15/20), rollover, claims, keeper claims and referral credits (#26).
contract SettlementTest is DailyDrawBase {
    // ---------------------------------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------------------------------

    function test_NoWinnerRollsTheWholePoolOver() public {
        buy(alice, many(10, 0), address(0)); // 00..09
        assertSolvent();

        vm.warp(firstCutoff);
        game.closeDraw(1);
        vm.expectEmit(true, false, false, true);
        emit DailyDraw.RolledOver(1, 10 * ONE_USDC);
        rng.fulfill(1, 50);

        DailyDraw.Draw memory d = game.getDraw(1);
        assertEq(uint8(d.status), uint8(DailyDraw.Status.Settled));
        assertEq(d.pool, 10 * ONE_USDC);
        assertEq(d.prizePerTicket, 0);
        assertEq(game.rollover(), 10 * ONE_USDC);
        assertEq(game.treasuryBalance(), ONE_USDC); // only the fees
        assertEq(game.buybackBalance(), 0);
        assertSolvent();

        vm.prank(alice);
        vm.expectRevert(DailyDraw.NothingToClaim.selector);
        game.claim(1, many(10, 0));
    }

    function test_RolloverIsCarriedIntoTheNextDraw() public {
        buy(alice, many(10, 0), address(0));
        closeAndDraw(50); // nobody wins: 10 USDC rolls over

        buy(bob, nums(42), address(0));
        buy(carol, many(5, 60), address(0));
        assertSolvent();
        uint256 drawId = closeAndDraw(42);
        assertEq(drawId, 2);

        // pool = 6 sales + 10 rollover = 16 USDC
        DailyDraw.Draw memory d = game.getDraw(2);
        assertEq(d.pool, 16 * ONE_USDC);
        assertEq(d.prizePerTicket, 10_400_000); // 65%
        assertEq(d.referralSharePerTicket, 3_200_000); // 20%
        assertEq(game.rollover(), 0);
        // treasury: draw 1 fees (1) + draw 2 team 10% (1.6) + draw 2 fees (0.6)
        assertEq(game.treasuryBalance(), 3_200_000);
        assertEq(game.buybackBalance(), 800_000);
        assertSolvent();

        uint256 before = usdc.balanceOf(bob);
        claimAs(bob, 2, 42);
        assertEq(usdc.balanceOf(bob) - before, 10_400_000);
        assertEq(game.treasuryBalance(), 6_400_000); // + unreferred share
        assertSolvent();

        game.withdrawTreasury();
        game.withdrawBuyback();
        assertEq(usdc.balanceOf(treasury), 6_400_000);
        assertEq(usdc.balanceOf(buyback), 800_000);
        assertEq(game.treasuryBalance(), 0);
        assertSolvent();
        assertEq(usdc.balanceOf(address(game)), 0);
    }

    function test_SettlementEventCarriesTheSplit() public {
        buy(bob, nums(42), address(0));
        buy(carol, many(10, 60), address(0)); // pool 11
        uint256 drawId = game.currentDrawId();
        vm.warp(firstCutoff);
        game.closeDraw(drawId);

        vm.expectEmit(true, false, false, true);
        emit DailyDraw.DrawSettled(
            1, 11 * ONE_USDC, 1, 7_150_000, 2_200_000, 1_100_000, 550_000, 1_100_000, 0
        );
        rng.fulfill(1, 42);
        assertEq(game.getDraw(1).settledAt, firstCutoff);
    }

    function test_RoundingDustRollsOver() public {
        // 3 winners on a 7 USDC pool: 4_550_000 / 3 and 1_400_000 / 3 leave dust.
        buy(alice, nums(42), address(0));
        buy(bob, nums(42), address(0));
        buy(carol, nums(42), address(0));
        buy(carol, many(2, 10), address(0));
        buy(bob, many(2, 20), address(0));
        closeAndDraw(42);

        DailyDraw.Draw memory d = game.getDraw(1);
        assertEq(d.prizePerTicket, 1_516_666);
        assertEq(d.referralSharePerTicket, 466_666);
        // 7_000_000 - 3 * (1_516_666 + 466_666) - 700_000 - 350_000 = 4
        assertEq(game.rollover(), 4);
        assertSolvent();
    }

    // ---------------------------------------------------------------------------------------------
    // Claims and referrals
    // ---------------------------------------------------------------------------------------------

    function test_SingleWinnerWithActiveReferrer() public {
        buy(alice, many(10, 0), address(0));
        buy(bob, nums(42), alice); // alice refers bob and played this draw
        buy(carol, many(5, 50), address(0));
        closeAndDraw(42); // pool 16

        (uint256 tickets, uint256 prize) = game.claimable(1, bob);
        assertEq(tickets, 1);
        assertEq(prize, 10_400_000);
        assertTrue(game.isActiveReferrer(alice, 1));

        uint256 before = usdc.balanceOf(bob);
        vm.expectEmit(true, true, true, true);
        emit DailyDraw.ReferralCredited(1, alice, bob, 3_200_000);
        vm.expectEmit(true, true, false, true);
        emit DailyDraw.PrizeClaimed(1, bob, bob, 1, 10_400_000);
        claimAs(bob, 1, 42);

        assertEq(usdc.balanceOf(bob) - before, 10_400_000);
        assertEq(game.referralBalance(alice), 3_200_000);
        assertTrue(game.claimed(1, bob));
        assertEq(game.getDraw(1).claimedTickets, 1);
        (tickets,) = game.claimable(1, bob);
        assertEq(tickets, 0);
        assertSolvent();

        before = usdc.balanceOf(alice);
        vm.expectEmit(true, false, false, true);
        emit DailyDraw.ReferralClaimed(alice, 3_200_000);
        vm.prank(alice);
        game.claimReferral();
        assertEq(usdc.balanceOf(alice) - before, 3_200_000);
        assertEq(game.referralBalance(alice), 0);
        assertSolvent();

        game.withdrawTreasury(); // 1.6 team + 1.6 fees
        game.withdrawBuyback(); // 0.8
        assertEq(usdc.balanceOf(treasury), 3_200_000);
        assertEq(usdc.balanceOf(buyback), 800_000);
        assertEq(usdc.balanceOf(address(game)), 0);
    }

    function test_UnreferredShareGoesToTreasuryAtClaim() public {
        buy(bob, nums(42), address(0));
        buy(carol, many(10, 60), address(0)); // pool 11
        closeAndDraw(42);
        uint256 treasuryBefore = game.treasuryBalance();

        vm.expectEmit(true, true, false, true);
        emit DailyDraw.ReferralShareToTreasury(1, bob, 2_200_000);
        claimAs(bob, 1, 42);

        assertEq(game.treasuryBalance() - treasuryBefore, 2_200_000);
        assertEq(game.totalReferralBalances(), 0);
        assertSolvent();
    }

    function test_ManyWinnersShareEquallyPerTicket() public {
        address dave = makeAddr("dave");
        fund(dave);
        buy(dave, many(10, 70), address(0)); // dave plays and refers alice
        buy(alice, same(2, 42), dave); // 2 winning tickets, referred by dave
        buy(alice, many(5, 0), address(0));
        buy(bob, nums(42), address(0)); // 1 winning ticket, no referrer
        buy(carol, nums(42), address(0)); // 1 winning ticket, no referrer
        buy(carol, many(1, 90), address(0));
        closeAndDraw(42); // pool 20, 4 winning tickets

        DailyDraw.Draw memory d = game.getDraw(1);
        assertEq(d.winningTickets, 4);
        assertEq(d.prizePerTicket, 3_250_000); // 13 / 4
        assertEq(d.referralSharePerTicket, 1_000_000); // 4 / 4

        uint256 a = usdc.balanceOf(alice);
        claimAs(alice, 1, 42);
        assertEq(usdc.balanceOf(alice) - a, 6_500_000);
        assertEq(game.referralBalance(dave), 2_000_000);

        uint256 treasuryBefore = game.treasuryBalance();
        claimAs(bob, 1, 42);
        claimAs(carol, 1, 42);
        assertEq(game.treasuryBalance() - treasuryBefore, 2_000_000);
        assertEq(game.getDraw(1).claimedTickets, 4);
        assertEq(game.unclaimedWinnings(), 0);
        assertSolvent();
    }

    function test_ClaimAcceptsAllYourNumbers() public {
        buy(alice, many(10, 37), address(0)); // 37..46
        closeAndDraw(42);
        vm.prank(alice);
        game.claim(1, many(10, 37));
        assertTrue(game.claimed(1, alice));
    }

    function test_InactiveReferrerSendsShareToTreasury() public {
        buy(alice, nums(1), address(0)); // alice's only purchase, in draw 1
        buy(bob, nums(2), alice);
        closeAndDraw(99);

        // 31 days pass; closing draw 2 late skips the missed days.
        vm.warp(firstCutoff + 31 days);
        closeAndDraw(99);
        buy(bob, nums(42), address(0));
        uint256 drawId = closeAndDraw(42);
        assertFalse(game.isActiveReferrer(alice, drawId));

        // alice playing after the cutoff doesn't make her active for the draw already settled.
        buy(alice, nums(5), address(0));
        assertFalse(game.isActiveReferrer(alice, drawId));
        assertTrue(game.isActiveReferrer(alice, game.currentDrawId()));

        uint256 treasuryBefore = game.treasuryBalance();
        claimAs(bob, drawId, 42);
        assertEq(game.referralBalance(alice), 0);
        assertEq(
            game.treasuryBalance() - treasuryBefore, game.getDraw(drawId).referralSharePerTicket
        );
        assertSolvent();
    }

    function test_ReferrerActivityWindowIsThirtyDaysBeforeCutoff() public {
        vm.warp(firstCutoff - 1);
        buy(alice, nums(1), address(0)); // alice's last purchase: 1 second before draw 1's cutoff
        closeAndDraw(99);

        vm.warp(firstCutoff + 28 days + 1 hours);
        closeAndDraw(99); // draw 2, closed late
        uint256 d3 = game.currentDrawId();
        assertEq(game.getDraw(d3).cutoff, firstCutoff + 29 days);
        assertTrue(game.isActiveReferrer(alice, d3)); // played 29 days + 1s before the cutoff

        closeAndDraw(99);
        uint256 d4 = game.currentDrawId();
        assertEq(game.getDraw(d4).cutoff, firstCutoff + 30 days);
        assertFalse(game.isActiveReferrer(alice, d4)); // 30 days + 1s before the cutoff

        assertFalse(game.isActiveReferrer(carol, 1)); // never played
        assertFalse(game.isActiveReferrer(address(0), 1));
    }

    function test_RevertWhen_ClaimingTwice() public {
        buy(bob, nums(42), address(0));
        closeAndDraw(42);
        claimAs(bob, 1, 42);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.AlreadyClaimed.selector, 1, bob));
        game.claim(1, nums(42));
    }

    function test_RevertWhen_ClaimingBeforeSettlement() public {
        buy(bob, nums(42), address(0));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotSettled.selector, 1));
        game.claim(1, nums(42));

        vm.warp(firstCutoff);
        game.closeDraw(1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.DrawNotSettled.selector, 1));
        game.claim(1, nums(42));
    }

    function test_RevertWhen_NoWinningTickets() public {
        buy(bob, nums(42), address(0));
        buy(carol, nums(7), address(0));
        closeAndDraw(42);

        vm.prank(bob); // bob holds 42 but doesn't list it
        vm.expectRevert(DailyDraw.NothingToClaim.selector);
        game.claim(1, nums(7));

        vm.prank(carol); // carol lists 42 but holds none
        vm.expectRevert(DailyDraw.NothingToClaim.selector);
        game.claim(1, nums(42));
    }

    function test_RevertWhen_NoReferralBalance() public {
        vm.prank(alice);
        vm.expectRevert(DailyDraw.NothingToClaim.selector);
        game.claimReferral();
    }

    // ---------------------------------------------------------------------------------------------
    // Keeper claims
    // ---------------------------------------------------------------------------------------------

    function test_KeeperClaimsForWinnerAfter24Hours() public {
        buy(alice, nums(3), address(0));
        buy(bob, nums(42), alice);
        closeAndDraw(42); // pool 2
        uint64 settledAt = game.getDraw(1).settledAt;

        vm.warp(settledAt + 24 hours - 1);
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(DailyDraw.KeeperClaimTooEarly.selector, 1, settledAt + 24 hours)
        );
        game.claimFor(bob, 1);

        vm.warp(settledAt + 24 hours);
        uint256 bobBefore = usdc.balanceOf(bob);
        uint256 keeperBefore = usdc.balanceOf(keeper);
        vm.expectEmit(true, true, false, true);
        emit DailyDraw.PrizeClaimed(1, bob, keeper, 1, 1_300_000);
        vm.prank(keeper);
        game.claimFor(bob, 1);

        assertEq(usdc.balanceOf(bob) - bobBefore, 1_300_000);
        assertEq(usdc.balanceOf(keeper), keeperBefore);
        assertEq(game.referralBalance(alice), 400_000);
        assertSolvent();

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(DailyDraw.AlreadyClaimed.selector, 1, bob));
        game.claim(1, nums(42));
    }

    function test_RevertWhen_ClaimForByNonKeeper() public {
        buy(bob, nums(42), address(0));
        closeAndDraw(42);
        vm.warp(block.timestamp + 2 days);
        bytes32 role = game.KEEPER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, carol, role
            )
        );
        vm.prank(carol);
        game.claimFor(bob, 1);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    function test_AdminChangesTreasuryAndBuybackReserve() public {
        address newTreasury = makeAddr("newTreasury");
        address newBuyback = makeAddr("newBuyback");
        vm.startPrank(admin);
        game.setTreasury(newTreasury);
        game.setBuybackReserve(newBuyback);
        vm.expectRevert(DailyDraw.InvalidParams.selector);
        game.setTreasury(address(0));
        vm.stopPrank();

        buy(bob, nums(42), address(0));
        buy(carol, many(10, 60), address(0)); // pool 11
        closeAndDraw(42);
        vm.prank(carol); // anyone may trigger it; the money goes to the current addresses
        game.withdrawTreasury();
        game.withdrawBuyback();
        assertEq(usdc.balanceOf(newTreasury), 2_200_000); // 1.1 team + 1.1 fees
        assertEq(usdc.balanceOf(newBuyback), 550_000);
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(usdc.balanceOf(carol), 1_000 * ONE_USDC - 11 * ONE_USDC); // paid nothing to withdraw

        bytes32 role = game.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, role
            )
        );
        vm.prank(alice);
        game.setTreasury(alice);
    }

    // ---------------------------------------------------------------------------------------------
    // Treasury and buy-back credits
    // ---------------------------------------------------------------------------------------------

    function test_SettlesAndClaimsWhileTreasuryIsFrozen() public {
        usdc.setFrozen(treasury, true);
        usdc.setFrozen(buyback, true);
        buy(bob, nums(42), address(0));
        buy(carol, many(10, 60), address(0)); // pool 11
        uint256 drawId = closeAndDraw(42); // the randomness callback must not revert

        assertEq(uint8(game.getDraw(drawId).status), uint8(DailyDraw.Status.Settled));
        assertEq(game.treasuryBalance(), 2_200_000); // 1.1 team + 1.1 fees
        assertEq(game.buybackBalance(), 550_000);

        // bob can still claim; his unreferred share is credited, not sent.
        claimAs(bob, drawId, 42);
        assertEq(game.treasuryBalance(), 4_400_000);
        assertSolvent();

        // Withdrawing to a frozen address fails and keeps the credit.
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.AccountFrozen.selector, treasury));
        game.withdrawTreasury();
        assertEq(game.treasuryBalance(), 4_400_000);

        // The admin points the treasury somewhere else and the credit moves there.
        address newTreasury = makeAddr("newTreasury");
        vm.prank(admin);
        game.setTreasury(newTreasury);
        game.withdrawTreasury();
        assertEq(usdc.balanceOf(newTreasury), 4_400_000);
        assertSolvent();
    }

    function test_WithdrawalsEmitAndEmptyTheBalances() public {
        buy(bob, nums(42), address(0));
        buy(carol, many(10, 60), address(0)); // pool 11
        vm.warp(firstCutoff);
        game.closeDraw(1);
        vm.expectEmit(true, false, false, true);
        emit DailyDraw.TreasuryCredited(1, 2_200_000);
        vm.expectEmit(true, false, false, true);
        emit DailyDraw.BuybackCredited(1, 550_000);
        rng.fulfill(1, 42);

        vm.expectEmit(true, false, false, true);
        emit DailyDraw.TreasuryWithdrawn(treasury, 2_200_000);
        game.withdrawTreasury();
        vm.expectEmit(true, false, false, true);
        emit DailyDraw.BuybackWithdrawn(buyback, 550_000);
        game.withdrawBuyback();

        assertEq(usdc.balanceOf(treasury), 2_200_000);
        assertEq(usdc.balanceOf(buyback), 550_000);
        vm.expectRevert(DailyDraw.NothingToClaim.selector);
        game.withdrawTreasury();
        vm.expectRevert(DailyDraw.NothingToClaim.selector);
        game.withdrawBuyback();
        assertSolvent();
    }

    function test_RejectsZeroReferrerActiveDays() public {
        DailyDraw.Params memory p = defaultParams();
        p.referrerActiveDays = 0;
        vm.prank(admin);
        vm.expectRevert(DailyDraw.InvalidParams.selector);
        game.setParams(p);
    }

    // ---------------------------------------------------------------------------------------------
    // Fuzz: the contract always holds exactly what it owes
    // ---------------------------------------------------------------------------------------------

    function testFuzz_BalanceAlwaysEqualsWhatIsOwed(uint256 seed) public {
        address[3] memory players = [alice, bob, carol];
        for (uint256 day; day < 4; ++day) {
            uint256 drawId = game.currentDrawId();
            for (uint256 i; i < 3; ++i) {
                uint256 r = uint256(keccak256(abi.encode(seed, day, i)));
                uint256[4] memory sizes = [uint256(1), 2, 5, 10];
                // Numbers 40..49 only, so winners are common.
                uint16[] memory n = new uint16[](sizes[r % 4]);
                for (uint256 j; j < n.length; ++j) {
                    n[j] = uint16(40 + (r >> (8 + j * 4)) % 10);
                }
                buy(players[i], n, i == 0 ? address(0) : players[i - 1]);
                assertSolvent();
            }
            uint16 winning = uint16(40 + (uint256(keccak256(abi.encode(seed, day))) % 12));
            closeAndDraw(winning);
            assertSolvent();

            for (uint256 i; i < 3; ++i) {
                (uint256 t,) = game.claimable(drawId, players[i]);
                if (t == 0) continue;
                vm.prank(players[i]);
                game.claim(drawId, nums(winning));
                assertSolvent();
            }
            assertEq(game.unclaimedWinnings(), 0);
        }
        for (uint256 i; i < 3; ++i) {
            if (game.referralBalance(players[i]) == 0) continue;
            vm.prank(players[i]);
            game.claimReferral();
            assertSolvent();
        }
        if (game.treasuryBalance() != 0) game.withdrawTreasury();
        if (game.buybackBalance() != 0) game.withdrawBuyback();
        assertSolvent();
        // Only the open draw's money and the rollover are left.
        DailyDraw.Draw memory open = game.getDraw(game.currentDrawId());
        assertEq(usdc.balanceOf(address(game)), game.rollover() + open.sales + open.fees);
    }
}
