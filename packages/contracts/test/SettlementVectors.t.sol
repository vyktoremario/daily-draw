// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {DailyDraw} from "../src/DailyDraw.sol";
import {DailyDrawBase} from "./DailyDrawBase.sol";
import {DailyDrawHarness} from "./harness/DailyDrawHarness.sol";

/// @notice Runs every case in packages/shared/test-vectors/settlement.json (the TypeScript reference
///         in packages/shared/src/settlement.ts) through on-chain settlement and claims.
/// @dev The reference sends unreferred referral shares to the team at settlement; on-chain they are
///      assigned when each winner claims, so the team total is compared after everyone has claimed.
contract SettlementVectorsTest is DailyDrawBase {
    uint16 internal constant WINNING = 42;
    string internal json;

    struct Case {
        string name;
        uint256 sales;
        uint256 rolloverIn;
        uint256 winningTickets;
        uint256 referred;
        uint256 pool;
        uint256 prizePerTicket;
        uint256 referralSharePerTicket;
        uint256 prizesTotal;
        uint256 referralsPaid;
        uint256 team;
        uint256 buyback;
        uint256 rolloverOut;
    }

    function setUp() public override {
        super.setUp();
        json =
            vm.readFile(string.concat(vm.projectRoot(), "/../shared/test-vectors/settlement.json"));
    }

    function test_SplitInVectorsMatchesDefaultParams() public view {
        DailyDraw.Params memory p = defaultParams();
        assertEq(vm.parseJsonUint(json, ".split.winnersBps"), p.winnersBps);
        assertEq(vm.parseJsonUint(json, ".split.teamBps"), p.teamBps);
        assertEq(vm.parseJsonUint(json, ".split.buybackBps"), p.buybackBps);
        assertEq(vm.parseJsonUint(json, ".split.referrersBps"), p.referrersBps);
    }

    function test_MatchesEverySharedVector() public {
        uint256 count;
        while (vm.keyExistsJson(json, string.concat(".cases[", vm.toString(count), "]"))) {
            ++count;
        }
        assertGt(count, 0, "no vectors");
        emit log_named_uint("settlement vectors checked", count);
        for (uint256 i; i < count; ++i) {
            runCase(readCase(i));
        }
    }

    function readCase(uint256 i) internal view returns (Case memory c) {
        string memory k = string.concat(".cases[", vm.toString(i), "]");
        c.name = vm.parseJsonString(json, string.concat(k, ".name"));
        c.sales = big(string.concat(k, ".input.sales"));
        c.rolloverIn = big(string.concat(k, ".input.rolloverIn"));
        c.winningTickets = vm.parseJsonUint(json, string.concat(k, ".input.winningTickets"));
        c.referred =
            vm.parseJsonUint(json, string.concat(k, ".input.winningTicketsWithActiveReferrer"));
        c.pool = big(string.concat(k, ".expected.pool"));
        c.prizePerTicket = big(string.concat(k, ".expected.prizePerTicket"));
        c.referralSharePerTicket = big(string.concat(k, ".expected.referralSharePerTicket"));
        c.prizesTotal = big(string.concat(k, ".expected.prizesTotal"));
        c.referralsPaid = big(string.concat(k, ".expected.referralsPaid"));
        c.team = big(string.concat(k, ".expected.team"));
        c.buyback = big(string.concat(k, ".expected.buyback"));
        c.rolloverOut = big(string.concat(k, ".expected.rolloverOut"));
    }

    /// @dev Amounts are decimal strings in the JSON (bigint-safe).
    function big(string memory key) internal view returns (uint256) {
        return vm.parseUint(vm.parseJsonString(json, key));
    }

    function runCase(Case memory c) internal {
        // A fresh game per case, so balances start at zero.
        firstCutoff = uint64(block.timestamp + 12 hours);
        DailyDrawHarness h = DailyDrawHarness(address(deploy(address(new DailyDrawHarness()))));
        game = h;
        address referrer = makeAddr("vector-referrer");
        h.seedPlay(referrer, 1); // active for draw 1

        h.seedSales(1, uint128(c.sales));
        h.seedRollover(c.rolloverIn);
        usdc.mint(address(h), c.sales + c.rolloverIn);

        address[] memory winners = new address[](c.winningTickets);
        for (uint256 i; i < c.winningTickets; ++i) {
            winners[i] = address(uint160(0x10000 + i));
            h.seedTicket(1, winners[i], WINNING, i < c.referred ? referrer : address(0));
        }
        h.seedTicket(1, makeAddr("loser"), WINNING + 1, address(0));

        closeAndDraw(WINNING);

        DailyDraw.Draw memory d = h.getDraw(1);
        assertEq(d.pool, c.pool, c.name);
        assertEq(d.prizePerTicket, c.prizePerTicket, c.name);
        assertEq(d.referralSharePerTicket, c.referralSharePerTicket, c.name);
        assertEq(h.rollover(), c.rolloverOut, c.name);
        assertEq(h.buybackBalance(), c.buyback, c.name);
        assertSolvent();

        uint256 prizesPaid;
        for (uint256 i; i < winners.length; ++i) {
            uint256 before = usdc.balanceOf(winners[i]);
            claimAs(winners[i], 1, WINNING);
            prizesPaid += usdc.balanceOf(winners[i]) - before;
            assertEq(usdc.balanceOf(winners[i]) - before, c.prizePerTicket, c.name);
        }

        assertEq(prizesPaid, c.prizesTotal, c.name);
        assertEq(h.referralBalance(referrer), c.referralsPaid, c.name);
        assertEq(h.totalReferralBalances(), c.referralsPaid, c.name);
        assertEq(h.treasuryBalance(), c.team, c.name); // seeded fees are 0
        assertEq(h.unclaimedWinnings(), 0, c.name);
        assertEq(
            usdc.balanceOf(address(h)), c.rolloverOut + c.referralsPaid + c.team + c.buyback, c.name
        );
        assertEq(prizesPaid + c.referralsPaid + c.team + c.buyback + c.rolloverOut, c.pool, c.name);
        assertSolvent();
    }
}
