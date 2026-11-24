// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {DailyDraw} from "../../src/DailyDraw.sol";
import {DailyDrawBase} from "../DailyDrawBase.sol";
import {DailyDrawHandler} from "./DailyDrawHandler.sol";

/// @notice The money rules of Design v0.2 ("Smart contract specification") as Foundry invariants
///         (#28). `DailyDrawHandler` plays random sequences of buys, closes, (late, duplicate and
///         stranger) fulfilments, claims, keeper claims, referral claims, withdrawals, voids,
///         refunds, sweeps, pauses, params changes, time jumps and stray transfers; after every
///         call each invariant below must hold. At the end of every run `afterInvariant` settles and
///         pays out everything and checks nobody's money is stuck.
contract DailyDrawInvariants is DailyDrawBase {
    uint256 internal constant BPS = 10_000;
    DailyDrawHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new DailyDrawHandler(game, usdc, rng, admin, keeper, treasury, buyback);

        bytes4[] memory selectors = new bytes4[](21);
        selectors[0] = handler.buyTickets.selector;
        selectors[1] = handler.buyTickets.selector; // listed 4 times: buying is the common action
        selectors[2] = handler.closeDraw.selector;
        selectors[3] = handler.fulfill.selector;
        selectors[4] = handler.fulfillAsStranger.selector;
        selectors[5] = handler.claim.selector;
        selectors[6] = handler.claimFor.selector;
        selectors[7] = handler.claimReferral.selector;
        selectors[8] = handler.withdrawTreasury.selector;
        selectors[9] = handler.withdrawBuyback.selector;
        selectors[10] = handler.voidDraw.selector;
        selectors[11] = handler.refund.selector;
        selectors[12] = handler.sweepUnclaimed.selector;
        selectors[13] = handler.pause.selector;
        selectors[14] = handler.setParams.selector;
        selectors[15] = handler.warp.selector;
        selectors[16] = handler.donate.selector;
        selectors[17] = handler.claim.selector;
        selectors[18] = handler.buyTickets.selector;
        selectors[19] = handler.buyTickets.selector;
        selectors[20] = handler.fulfill.selector;
        targetSelector(StdInvariant.FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    // ---------------------------------------------------------------------------------------------
    // 1. Solvency: the USDC balance always covers everything owed (equal, apart from stray tokens)
    // ---------------------------------------------------------------------------------------------

    function invariant_BalanceCoversEverythingOwed() public view {
        uint256 balance = usdc.balanceOf(address(game));
        assertGe(balance, owed(), "balance < owed");
        assertEq(balance, owed() + handler.stray(), "balance != owed + stray tokens");
    }

    // ---------------------------------------------------------------------------------------------
    // 2. Per settled draw: prizes + referral shares + company share <= pool, the rest rolls over
    // ---------------------------------------------------------------------------------------------

    function invariant_SettlementNeverExceedsThePool() public view {
        uint256 last = game.currentDrawId();
        for (uint256 id = 1; id <= last; ++id) {
            DailyDraw.Draw memory d = game.getDraw(id);
            if (d.status != DailyDraw.Status.Settled && d.status != DailyDraw.Status.Swept) {
                continue;
            }
            DailyDraw.Params memory p = d.params;
            uint256 pool = d.pool;
            assertEq(pool, uint256(d.sales) + handler.rolloverIn(id), "pool != sales + rollover in");

            uint256 w = d.winningTickets;
            uint256 toWinners = w * (uint256(d.prizePerTicket) + d.referralSharePerTicket);
            uint256 company = w == 0 ? 0 : pool * p.teamBps / BPS + pool * p.buybackBps / BPS;
            assertLe(toWinners + company, pool, "split exceeds pool");
            assertEq(
                toWinners + company + handler.rolloverOut(id), pool, "leftover not rolled over"
            );
            if (w == 0) assertEq(handler.rolloverOut(id), pool, "unwon pool not rolled over");
            if (w != 0) {
                assertLe(w * d.prizePerTicket, pool * p.winnersBps / BPS, "prizes over 65%");
                assertLe(
                    w * d.referralSharePerTicket, pool * p.referrersBps / BPS, "referrals over 20%"
                );
            }
            assertLe(d.claimedTickets, w, "more tickets claimed than won");
            assertLe(handler.prizesPaidFor(id), w * d.prizePerTicket, "paid more than the prizes");
            assertEq(
                handler.prizesPaidFor(id), uint256(d.claimedTickets) * d.prizePerTicket, "paid"
            );
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 3. No ticket accepted at or after a draw's cutoff
    // ---------------------------------------------------------------------------------------------

    function invariant_NoTicketAtOrAfterCutoff() public view {
        assertEq(handler.violation(handler.CUTOFF()), "");
        address[] memory players = handler.actors();
        uint256 last = game.currentDrawId();
        for (uint256 id = 1; id <= last; ++id) {
            DailyDraw.Draw memory d = game.getDraw(id);
            if (handler.wasClosed(id)) {
                assertTrue(d.status != DailyDraw.Status.Open, "closed draw reopened");
                assertEq(d.ticketCount, handler.ticketCountAtClose(id), "tickets after close");
            }
            for (uint256 i; i < players.length; ++i) {
                assertLe(game.ticketsBoughtBy(id, players[i]), d.params.maxTicketsPerWallet);
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 4. A draw's winning number is set at most once, and only by the provider
    // ---------------------------------------------------------------------------------------------

    function invariant_WinningNumberSetOnceByProvider() public view {
        assertEq(handler.violation(handler.WINNING()), "");
        uint256 last = game.currentDrawId();
        for (uint256 id = 1; id <= last; ++id) {
            DailyDraw.Draw memory d = game.getDraw(id);
            uint256 settled = handler.settlements(id);
            assertLe(settled, 1, "settled more than once");
            bool drawn = d.status == DailyDraw.Status.Settled || d.status == DailyDraw.Status.Swept;
            // Drawn exactly when the provider's callback was accepted through the handler.
            assertEq(drawn ? 1 : 0, settled, "drawn without the provider");
            if (drawn) assertEq(d.winningNumber, handler.winningAtSettle(id), "number changed");
            else assertEq(d.winningNumber, 0, "number set on an undrawn draw");
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 5. Every ticket is paid at most once (prize or refund, never both); one referral credit
    // ---------------------------------------------------------------------------------------------

    function invariant_TicketPaidAtMostOnce() public view {
        assertEq(handler.violation(handler.PAID_ONCE()), "");
        address[] memory players = handler.actors();
        uint256 last = game.currentDrawId();
        for (uint256 id = 1; id <= last; ++id) {
            uint256 refunded;
            for (uint256 i; i < players.length; ++i) {
                address a = players[i];
                uint256 claims = handler.prizeClaims(id, a);
                assertLe(claims, 1, "prize paid twice");
                assertEq(handler.referralCredits(id, a), claims, "referral credited twice");
                assertTrue(claims == 0 || handler.refundsTo(id, a) == 0, "prize and refund");
                assertEq(game.claimed(id, a), claims == 1, "claimed flag out of step");
                uint16[] memory played = handler.numbersPlayed(id, a);
                for (uint256 j; j < played.length; ++j) {
                    assertLe(handler.timesPaid(id, a, played[j]), 1, "ticket paid twice");
                    assertEq(
                        game.ticketsOf(id, a, played[j]),
                        handler.ticketsHeld(id, a, played[j]),
                        "ticket count"
                    );
                }
            }
            DailyDraw.Draw memory d = game.getDraw(id);
            refunded = handler.refundsPaidFor(id);
            assertEq(d.refunded, refunded, "refund books");
            uint256 paidIn = uint256(d.sales) + d.fees;
            assertLe(refunded, paidIn, "refunded more than paid in");
            if (d.status != DailyDraw.Status.Voided) assertEq(refunded, 0, "refund of live draw");
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 6. A player's referrer is set at most once, never to themselves
    // ---------------------------------------------------------------------------------------------

    function invariant_ReferrerSetOnceNeverSelf() public view {
        assertEq(handler.violation(handler.REFERRER()), "");
        address[] memory players = handler.actors();
        for (uint256 i; i < players.length; ++i) {
            address a = players[i];
            address r = game.referrerOf(a);
            assertTrue(r != a, "self-referral");
            assertLe(handler.referrerChanges(a), 1, "referrer changed");
            assertEq(r, handler.firstReferrer(a), "referrer differs from the first one set");
        }
        assertEq(game.referrerOf(handler.outsider()), address(0), "non-player got a referrer");
    }

    // ---------------------------------------------------------------------------------------------
    // 7. Nobody moves money outside the rules: USDC in = USDC out + balance, and the books agree
    // ---------------------------------------------------------------------------------------------

    function invariant_MoneyInEqualsMoneyOutPlusBalance() public view {
        assertEq(handler.violation(handler.MONEY()), "");
        uint256 out = handler.prizesPaid() + handler.refundsPaid() + handler.referralsPaid()
            + handler.treasuryPaid() + handler.buybackPaid();
        assertEq(
            handler.deposited() + handler.stray(),
            out + usdc.balanceOf(address(game)),
            "in != out + balance"
        );
        assertEq(usdc.balanceOf(treasury), handler.treasuryPaid(), "treasury paid outside rules");
        assertEq(usdc.balanceOf(buyback), handler.buybackPaid(), "buy-back paid outside rules");
        assertEq(usdc.balanceOf(keeper), 0, "keeper got paid");

        // Every token is with a known party: nothing leaked to an unknown address.
        address[] memory players = handler.actors();
        uint256 known = usdc.balanceOf(address(game)) + usdc.balanceOf(treasury)
            + usdc.balanceOf(buyback) + usdc.balanceOf(handler.outsider()) + usdc.balanceOf(alice)
            + usdc.balanceOf(bob) + usdc.balanceOf(carol);
        uint256 referralBooks = game.referralBalance(handler.outsider());
        for (uint256 i; i < players.length; ++i) {
            known += usdc.balanceOf(players[i]);
            referralBooks += game.referralBalance(players[i]);
        }
        assertEq(known, usdc.totalSupply(), "tokens left the known parties");
        assertEq(game.totalReferralBalances(), referralBooks, "referral total != sum of balances");

        // Unclaimed winnings are exactly the unpaid winning tickets of settled draws.
        uint256 unpaid;
        uint256 last = game.currentDrawId();
        for (uint256 id = 1; id <= last; ++id) {
            DailyDraw.Draw memory d = game.getDraw(id);
            if (d.status != DailyDraw.Status.Settled) continue;
            unpaid += (uint256(d.winningTickets) - d.claimedTickets)
                * (uint256(d.prizePerTicket) + d.referralSharePerTicket);
        }
        assertEq(game.unclaimedWinnings(), unpaid, "unclaimed winnings books");
    }

    // ---------------------------------------------------------------------------------------------
    // End of every run: pay everyone out; only the rollover and open draws' money may remain
    // ---------------------------------------------------------------------------------------------

    function afterInvariant() external {
        handler.drain();
        assertEq(handler.violation(handler.MONEY()), "", "drain");
        assertEq(handler.violation(handler.PAID_ONCE()), "", "drain");
        assertEq(handler.violation(handler.WINNING()), "", "drain");
        assertEq(game.unclaimedWinnings(), 0, "prizes left unclaimable");
        assertEq(game.totalReferralBalances(), 0, "referral balances stuck");
        assertEq(game.treasuryBalance(), 0, "treasury stuck");
        assertEq(game.buybackBalance(), 0, "buy-back stuck");

        uint256 held = game.rollover() + handler.stray();
        uint256 last = game.currentDrawId();
        for (uint256 id = 1; id <= last; ++id) {
            DailyDraw.Draw memory d = game.getDraw(id);
            if (d.status == DailyDraw.Status.Open) held += uint256(d.sales) + d.fees;
            if (d.status == DailyDraw.Status.Voided) {
                assertEq(d.refunded, uint256(d.sales) + d.fees, "voided draw not fully refunded");
            }
        }
        assertEq(usdc.balanceOf(address(game)), held, "money stuck after paying everyone");
    }
}
