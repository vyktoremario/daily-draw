// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {DailyDraw} from "../../src/DailyDraw.sol";
import {MockRandomness, MockUSDC} from "../mocks/Mocks.sol";

/// @notice Drives `DailyDraw` with bounded random actions for the invariant suite (#28).
/// @dev Every call into the game goes through try/catch, so the handler itself never reverts and
///      a rejected action is simply a no-op. After each accepted action the handler checks what
///      the action may do (exact amounts, who receives them, state transitions) and records the
///      first breach per invariant in `violation`. Ghost variables track every token that enters
///      or leaves the game, every ticket bought, and every payment per ticket, so the invariants in
///      `DailyDrawInvariants` can compare the contract's books against an independent record.
contract DailyDrawHandler is CommonBase, StdCheats, StdUtils {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant ONE_USDC = 1_000_000;

    // Violation categories, one per invariant in `DailyDrawInvariants`.
    bytes32 public constant CUTOFF = "cutoff";
    bytes32 public constant WINNING = "winning";
    bytes32 public constant PAID_ONCE = "paidOnce";
    bytes32 public constant REFERRER = "referrer";
    bytes32 public constant MONEY = "money";

    DailyDraw public immutable game;
    MockUSDC public immutable usdc;
    MockRandomness public immutable rng;
    address public immutable admin; // multisig; also stands in for the timelock in the base setup
    address public immutable keeper;
    address public immutable treasury;
    address public immutable buyback;
    /// @dev A referrer who never plays, so is never active: their referees' shares go to treasury.
    address public immutable outsider;

    address[] internal _actors;
    /// @dev Every draw that was closed, in order (pending, settled, swept or voided).
    uint256[] internal _closedDraws;

    // --- Money ghosts ---------------------------------------------------------------------------

    uint256 public deposited; // pulled from players by buyTickets
    uint256 public stray; // sent straight to the contract, outside the rules
    uint256 public prizesPaid;
    uint256 public refundsPaid;
    uint256 public referralsPaid;
    uint256 public treasuryPaid;
    uint256 public buybackPaid;

    // --- Ticket ghosts --------------------------------------------------------------------------

    mapping(uint256 drawId => mapping(address player => mapping(uint256 number => uint256))) public
        ticketsHeld;
    mapping(uint256 drawId => mapping(uint256 number => uint256)) public ticketsOnNumber;
    mapping(uint256 drawId => mapping(address player => uint16[])) internal _numbersPlayed;
    /// @dev Payments (prize or refund) per ticket group (draw, player, number). Must stay <= 1.
    mapping(uint256 drawId => mapping(address player => mapping(uint256 number => uint256))) public
        timesPaid;
    mapping(uint256 drawId => mapping(address player => uint256)) public prizeClaims;
    mapping(uint256 drawId => mapping(address player => uint256)) public referralCredits;
    mapping(uint256 drawId => mapping(address player => uint256)) public refundsTo;
    mapping(uint256 drawId => uint256) public prizesPaidFor;
    mapping(uint256 drawId => uint256) public refundsPaidFor;

    // --- Draw ghosts ----------------------------------------------------------------------------

    mapping(uint256 drawId => uint256) public settlements;
    mapping(uint256 drawId => uint16) public winningAtSettle;
    mapping(uint256 drawId => uint256) public rolloverIn;
    mapping(uint256 drawId => uint256) public rolloverOut;
    mapping(uint256 drawId => uint32) public ticketCountAtClose;
    mapping(uint256 drawId => bool) public wasClosed;

    // --- Referrer ghosts ------------------------------------------------------------------------

    mapping(address player => uint256) public referrerChanges;
    mapping(address player => address) public firstReferrer;

    // --- Findings -------------------------------------------------------------------------------

    mapping(bytes32 category => string) public violation;
    mapping(bytes32 action => uint256) public calls;
    /// @dev Accepted actions, to check a run really reaches settlements, claims, refunds and sweeps.
    mapping(bytes32 action => uint256) public succeeded;

    constructor(
        DailyDraw game_,
        MockUSDC usdc_,
        MockRandomness rng_,
        address admin_,
        address keeper_,
        address treasury_,
        address buyback_
    ) {
        game = game_;
        usdc = usdc_;
        rng = rng_;
        admin = admin_;
        keeper = keeper_;
        treasury = treasury_;
        buyback = buyback_;
        outsider = makeAddr("inv-outsider");
        for (uint256 i; i < 5; ++i) {
            address a = makeAddr(string.concat("inv-player-", vm.toString(i)));
            _actors.push(a);
            usdc.mint(a, 1_000_000 * ONE_USDC);
            vm.prank(a);
            usdc.approve(address(game_), type(uint256).max);
        }
    }

    // =============================================================================================
    // Actions (fuzz targets)
    // =============================================================================================

    function buyTickets(
        uint256 actorSeed,
        uint256 bundleSeed,
        uint256 numberSeed,
        uint256 referrerSeed,
        uint256 drawSeed
    ) external {
        calls["buyTickets"]++;
        address player = _actor(actorSeed);
        uint256 drawId = game.currentDrawId();
        if (drawSeed % 10 == 0) {
            // Aim at a draw that isn't open (closed, settled, voided or not yet opened).
            drawId = bound(drawSeed, 1, drawId + 1);
        } else if (drawSeed % 4 != 1 && block.timestamp >= game.getDraw(drawId).cutoff) {
            // Mostly close a draw whose cutoff has passed and buy into the next one; otherwise
            // try buying into it after its cutoff, which must be rejected.
            _close(drawId);
            drawId = game.currentDrawId();
        } else if (drawSeed % 7 == 0) {
            // Exactly at the cutoff, or the second before it: the edge of the sales window.
            uint256 cutoff = game.getDraw(drawId).cutoff;
            if (block.timestamp < cutoff) vm.warp(cutoff - (drawSeed >> 8) % 2);
        }
        uint16[] memory numbers = _pickNumbers(drawId, bundleSeed, numberSeed);
        _buy(player, drawId, numbers, _pickReferrer(player, referrerSeed));
    }

    function closeDraw(uint256 seed) external {
        calls["closeDraw"]++;
        uint256 drawId = game.currentDrawId();
        if (seed % 8 == 0) drawId = bound(seed, 1, drawId + 1); // usually not open: must revert
        DailyDraw.Draw memory d = game.getDraw(drawId);
        // Mostly move on to the cutoff, so draws progress; sometimes try to close early.
        if (seed % 4 != 0 && block.timestamp < d.cutoff) {
            vm.warp(uint256(d.cutoff) + seed % 2 hours);
        }
        _close(drawId);
    }

    /// @notice Fulfil through the mock provider: a pending draw, or any closed draw (duplicate
    ///         fulfilments of settled draws, late fulfilments of voided ones).
    function fulfill(uint256 drawSeed, uint256 value) external {
        calls["fulfill"]++;
        if (_closedDraws.length == 0) return;
        uint256 drawId = drawSeed % 2 == 0 ? _firstPending() : 0;
        if (drawId == 0) drawId = _closedDraws[drawSeed % _closedDraws.length];
        _fulfill(drawId, _biasValue(value));
    }

    /// @notice Someone other than the provider tries to set a winning number. Must never succeed.
    function fulfillAsStranger(uint256 actorSeed, uint256 drawSeed, uint256 value) external {
        calls["fulfillAsStranger"]++;
        if (_closedDraws.length == 0) return;
        uint256 drawId = _closedDraws[drawSeed % _closedDraws.length];
        uint256 requestId = game.getDraw(drawId).requestId;
        address caller = actorSeed % 2 == 0 ? _actor(actorSeed) : admin;
        vm.prank(caller);
        try game.fulfillRandomness(requestId, value) {
            _flag(WINNING, "fulfillRandomness accepted from a non-provider");
        } catch {}
    }

    function claim(uint256 actorSeed, uint256 drawSeed, uint256 mode) external {
        calls["claim"]++;
        if (_closedDraws.length == 0) return;
        address player = _actor(actorSeed);
        uint256 drawId = _closedDraws[drawSeed % _closedDraws.length];
        // Mostly aim at an unclaimed winner, otherwise anyone (which must usually be rejected).
        if (mode % 4 != 3) (drawId, player) = _findWinner(drawId, player, drawSeed, actorSeed);
        uint16[] memory numbers;
        if (mode % 3 == 0) {
            numbers = new uint16[](1);
            numbers[0] = game.getDraw(drawId).winningNumber;
        } else if (mode % 3 == 1) {
            numbers = _numbersPlayed[drawId][player];
        } else {
            numbers = new uint16[](1);
            numbers[0] = uint16(mode % 100);
        }
        _claim(player, player, drawId, numbers);
    }

    function claimFor(uint256 actorSeed, uint256 drawSeed, uint256 callerSeed) external {
        calls["claimFor"]++;
        if (_closedDraws.length == 0) return;
        address player = _actor(actorSeed);
        uint256 drawId = _closedDraws[drawSeed % _closedDraws.length];
        if (callerSeed % 4 != 3) {
            (drawId, player) = _findWinner(drawId, player, drawSeed, actorSeed);
        }
        address caller = callerSeed % 5 == 0 ? _actor(callerSeed) : keeper;
        // Keepers may only claim 24 hours after settlement; sometimes wait that out.
        if (callerSeed % 3 == 0) vm.warp(block.timestamp + game.KEEPER_CLAIM_DELAY());
        _claim(caller, player, drawId, new uint16[](0));
    }

    function claimReferral(uint256 seed) external {
        calls["claimReferral"]++;
        address who = seed % 6 == 5 ? outsider : _actor(seed);
        // Mostly someone with a referral balance; otherwise anyone (rejected when it's zero).
        for (uint256 i; seed % 4 != 3 && i < _actors.length; ++i) {
            if (game.referralBalance(_actorAt(seed, i)) != 0) {
                who = _actorAt(seed, i);
                break;
            }
        }
        _claimReferral(who);
    }

    function withdrawTreasury(uint256 seed) external {
        calls["withdrawTreasury"]++;
        _withdraw(true, _actor(seed));
    }

    function withdrawBuyback(uint256 seed) external {
        calls["withdrawBuyback"]++;
        _withdraw(false, _actor(seed));
    }

    function voidDraw(uint256 drawSeed, uint256 callerSeed) external {
        calls["voidDraw"]++;
        if (_closedDraws.length == 0) return;
        uint256 drawId = drawSeed % 4 == 0 ? _firstPending() : 0;
        if (drawId == 0) drawId = _closedDraws[drawSeed % _closedDraws.length];
        // Admin may void at once; anyone else only after VOID_DELAY. Sometimes wait it out.
        if (callerSeed % 4 == 1) {
            vm.warp(block.timestamp + game.VOID_DELAY() + callerSeed % 1 hours);
        }
        _void(drawId, callerSeed % 2 == 0 ? admin : _actor(callerSeed));
    }

    function refund(uint256 actorSeed, uint256 drawSeed) external {
        calls["refund"]++;
        if (_closedDraws.length == 0) return;
        address player = _actor(actorSeed);
        uint256 drawId = _closedDraws[drawSeed % _closedDraws.length];
        if (actorSeed % 4 != 3) {
            (drawId, player) = _findVoidedPlayer(drawId, player, drawSeed, actorSeed);
        }
        uint16[] memory played = _numbersPlayed[drawId][player];
        uint16[] memory numbers;
        if (played.length == 0) {
            numbers = new uint16[](1);
            numbers[0] = uint16(actorSeed % 100);
        } else {
            // Repeat the first number to check a list with duplicates refunds it once.
            numbers = new uint16[](played.length + 1);
            for (uint256 i; i < played.length; ++i) {
                numbers[i] = played[i];
            }
            numbers[played.length] = played[0];
        }
        _refund(player, drawId, numbers);
    }

    function sweepUnclaimed(uint256 drawSeed, uint256 seed) external {
        calls["sweepUnclaimed"]++;
        if (_closedDraws.length == 0) return;
        uint256 drawId = _closedDraws[drawSeed % _closedDraws.length];
        if (seed % 3 == 0) {
            vm.warp(
                block.timestamp + uint256(game.getDraw(drawId).params.unclaimedPrizeDays) * 1 days
            );
        }
        _sweep(drawId, _actor(seed));
    }

    /// @notice Pause a quarter of the time, otherwise unpause, so runs aren't mostly paused.
    function pause(uint256 seed) external {
        calls["pause"]++;
        vm.prank(admin);
        if (seed % 4 == 0) {
            try game.pause() {} catch {}
        } else {
            try game.unpause() {} catch {}
        }
    }

    /// @notice Valid params variations through `PARAMS_ROLE` (the timelock, here the admin), plus
    ///         an invalid set now and then that must be rejected. Only future draws pick them up.
    function setParams(uint256 seed) external {
        calls["setParams"]++;
        DailyDraw.Params memory p = DailyDraw.Params({
            // An odd price with no fee makes rounding dust likely.
            ticketPrice: uint128([ONE_USDC, 2 * ONE_USDC, 1_000_003][seed % 3]),
            feeBps: 0,
            numberRange: uint16([100, 10, 37][(seed >> 8) % 3]),
            winnersBps: 6_500,
            teamBps: 1_000,
            buybackBps: 500,
            referrersBps: 2_000,
            maxTicketsPerWallet: uint32([20, 10, 30][(seed >> 16) % 3]),
            drawInterval: uint32([1 days, 12 hours][(seed >> 24) % 2]),
            referrerActiveDays: uint16([30, 1][(seed >> 32) % 2]),
            unclaimedPrizeDays: uint16([30, 1][(seed >> 40) % 2])
        });
        if (p.ticketPrice % 10 == 0) p.feeBps = uint16([200, 1_000, 2_000, 0][(seed >> 48) % 4]);
        if ((seed >> 56) % 3 == 1) {
            (p.winnersBps, p.teamBps, p.buybackBps, p.referrersBps) = (7_000, 1_000, 0, 2_000);
        } else if ((seed >> 56) % 3 == 2) {
            (p.winnersBps, p.teamBps, p.buybackBps, p.referrersBps) = (5_001, 1_333, 1_111, 2_555);
        }
        bool invalid = (seed >> 64) % 10 == 0;
        if (invalid) p.feeBps = 2_001;
        vm.prank(admin);
        try game.setParams(p) {
            if (invalid) _flag(MONEY, "setParams accepted invalid params");
        } catch {
            if (!invalid) _flag(MONEY, "setParams rejected valid params");
        }
    }

    function warp(uint256 seed) external {
        calls["warp"]++;
        uint256 choice = seed % 10;
        uint256 by;
        if (choice < 5) by = bound(seed, 1 minutes, 6 hours);
        else if (choice < 7) by = 1 days;
        else if (choice < 9) by = 25 hours;
        else by = 31 days;
        vm.warp(block.timestamp + by);
    }

    /// @notice Tokens sent to the contract outside `buyTickets`. They belong to nobody, so the
    ///         balance may exceed what is owed by exactly this much.
    function donate(uint256 amount) external {
        calls["donate"]++;
        amount = bound(amount, 1, 100 * ONE_USDC);
        usdc.mint(address(game), amount);
        stray += amount;
    }

    // =============================================================================================
    // End-of-run drain: everyone takes out what they are owed
    // =============================================================================================

    /// @notice Settles every pending draw, claims every prize, refunds every voided ticket, and
    ///         withdraws every referral, treasury and buy-back balance. Called by `afterInvariant`.
    function drain() external {
        vm.prank(admin);
        try game.unpause() {} catch {}
        for (uint256 i; i < _closedDraws.length; ++i) {
            uint256 drawId = _closedDraws[i];
            if (game.getDraw(drawId).status == DailyDraw.Status.Closed) {
                _fulfill(drawId, uint256(keccak256(abi.encode(drawId))));
            }
        }
        for (uint256 i; i < _closedDraws.length; ++i) {
            uint256 drawId = _closedDraws[i];
            DailyDraw.Draw memory d = game.getDraw(drawId);
            for (uint256 j; j < _actors.length; ++j) {
                address a = _actors[j];
                if (d.status == DailyDraw.Status.Settled) {
                    if (ticketsHeld[drawId][a][d.winningNumber] != 0 && !game.claimed(drawId, a)) {
                        _claim(a, a, drawId, _numbersPlayed[drawId][a]);
                    }
                } else if (d.status == DailyDraw.Status.Voided) {
                    if (_numbersPlayed[drawId][a].length != 0) {
                        _refund(a, drawId, _numbersPlayed[drawId][a]);
                    }
                }
            }
        }
        for (uint256 j; j < _actors.length; ++j) {
            _claimReferral(_actors[j]);
        }
        _claimReferral(outsider);
        _withdraw(true, outsider);
        _withdraw(false, outsider);
    }

    // =============================================================================================
    // Views for the invariants
    // =============================================================================================

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function closedDraws() external view returns (uint256[] memory) {
        return _closedDraws;
    }

    function numbersPlayed(uint256 drawId, address player) external view returns (uint16[] memory) {
        return _numbersPlayed[drawId][player];
    }

    // =============================================================================================
    // Action bodies with post-condition checks
    // =============================================================================================

    function _buy(address player, uint256 drawId, uint16[] memory numbers, address referrer)
        internal
    {
        DailyDraw.Draw memory d = game.getDraw(drawId);
        address referrerBefore = game.referrerOf(player);
        bool firstPlay = game.lastPlayed(player) == 0;
        uint256 balanceBefore = usdc.balanceOf(address(game));

        vm.prank(player);
        try game.buyTickets(drawId, numbers, referrer) {}
        catch {
            return;
        }

        if (d.status != DailyDraw.Status.Open) {
            _flag(CUTOFF, "ticket accepted for a draw not open");
        }
        if (block.timestamp >= d.cutoff) _flag(CUTOFF, "ticket accepted at or after the cutoff");
        if (game.ticketsBoughtBy(drawId, player) > d.params.maxTicketsPerWallet) {
            _flag(CUTOFF, "wallet limit exceeded");
        }

        uint256 price = uint256(d.params.ticketPrice) * numbers.length;
        uint256 paid = usdc.balanceOf(address(game)) - balanceBefore;
        if (paid != price + price * d.params.feeBps / BPS) _flag(MONEY, "buy pulled wrong amount");
        deposited += paid;
        ++succeeded["buyTickets"];

        for (uint256 i; i < numbers.length; ++i) {
            uint256 n = numbers[i];
            if (ticketsHeld[drawId][player][n] == 0) {
                _numbersPlayed[drawId][player].push(uint16(n));
            }
            ++ticketsHeld[drawId][player][n];
            ++ticketsOnNumber[drawId][n];
        }

        address referrerAfter = game.referrerOf(player);
        if (referrerAfter != referrerBefore) {
            if (++referrerChanges[player] == 1) firstReferrer[player] = referrerAfter;
            if (!firstPlay || referrerBefore != address(0) || referrerAfter != referrer) {
                _flag(REFERRER, "referrer set other than on first play");
            }
        } else if (firstPlay && referrer != address(0) && referrer != player) {
            _flag(REFERRER, "referrer not recorded on first play");
        }
        if (referrerAfter == player) _flag(REFERRER, "player referred themselves");
    }

    function _close(uint256 drawId) internal {
        DailyDraw.Draw memory d = game.getDraw(drawId);
        uint256 balanceBefore = usdc.balanceOf(address(game));
        try game.closeDraw(drawId) {}
        catch {
            return;
        }
        if (d.status != DailyDraw.Status.Open || block.timestamp < d.cutoff) {
            _flag(CUTOFF, "draw closed before its cutoff or while not open");
        }
        if (usdc.balanceOf(address(game)) != balanceBefore) _flag(MONEY, "closeDraw moved money");
        wasClosed[drawId] = true;
        ticketCountAtClose[drawId] = game.getDraw(drawId).ticketCount;
        _closedDraws.push(drawId);
        ++succeeded["closeDraw"];
        DailyDraw.Draw memory next = game.getDraw(drawId + 1);
        if (next.status != DailyDraw.Status.Open || next.cutoff <= block.timestamp) {
            _flag(CUTOFF, "next draw not opened with a future cutoff");
        }
    }

    function _fulfill(uint256 drawId, uint256 value) internal {
        DailyDraw.Draw memory before = game.getDraw(drawId);
        uint256 rolloverBefore = game.rollover();
        uint256 balanceBefore = usdc.balanceOf(address(game));

        try rng.fulfill(before.requestId, value) {}
        catch {
            if (before.status == DailyDraw.Status.Closed) {
                _flag(WINNING, "valid fulfilment of a pending draw reverted");
            }
            return;
        }

        DailyDraw.Draw memory d = game.getDraw(drawId);
        if (usdc.balanceOf(address(game)) != balanceBefore) _flag(MONEY, "settlement moved money");

        if (before.status == DailyDraw.Status.Voided) {
            // Late number for a voided draw: ignored, nothing changes.
            if (
                d.status != DailyDraw.Status.Voided || d.winningNumber != 0
                    || game.rollover() != rolloverBefore
            ) _flag(WINNING, "late randomness changed a voided draw");
            ++succeeded["lateFulfill"];
            return;
        }
        if (before.status != DailyDraw.Status.Closed) {
            _flag(WINNING, "randomness accepted for a draw that was not waiting for it");
            return;
        }

        ++settlements[drawId];
        ++succeeded[d.winningTickets == 0 ? bytes32("settleNoWinner") : bytes32("settleWon")];
        winningAtSettle[drawId] = d.winningNumber;
        rolloverIn[drawId] = rolloverBefore;
        rolloverOut[drawId] = game.rollover();
        if (d.status != DailyDraw.Status.Settled) _flag(WINNING, "fulfilled draw not settled");
        if (d.winningNumber != value % d.params.numberRange) {
            _flag(WINNING, "winning number is not the provider's value");
        }
        if (d.winningTickets != ticketsOnNumber[drawId][d.winningNumber]) {
            _flag(WINNING, "winning ticket count wrong");
        }
    }

    struct ClaimBefore {
        DailyDraw.Draw d;
        address referrer;
        bool active;
        bool claimed;
        uint256 game;
        uint256 player;
        uint256 treasuryBalance;
        uint256 referralBalance;
        uint256 unclaimed;
    }

    /// @dev `caller == player` uses `claim(numbers)`; otherwise `claimFor(player)` from `caller`.
    function _claim(address caller, address player, uint256 drawId, uint16[] memory numbers)
        internal
    {
        ClaimBefore memory b;
        b.d = game.getDraw(drawId);
        b.referrer = game.referrerOf(player);
        b.active = game.isActiveReferrer(b.referrer, drawId);
        b.claimed = game.claimed(drawId, player);
        b.game = usdc.balanceOf(address(game));
        b.player = usdc.balanceOf(player);
        b.treasuryBalance = game.treasuryBalance();
        b.referralBalance = game.referralBalance(b.referrer);
        b.unclaimed = game.unclaimedWinnings();

        vm.prank(caller);
        if (caller == player) {
            try game.claim(drawId, numbers) {}
            catch {
                return;
            }
        } else {
            try game.claimFor(player, drawId) {}
            catch {
                return;
            }
            if (!game.hasRole(game.KEEPER_ROLE(), caller)) _flag(MONEY, "claimFor by non-keeper");
            ++succeeded["claimFor"];
            if (block.timestamp < uint256(b.d.settledAt) + game.KEEPER_CLAIM_DELAY()) {
                _flag(MONEY, "keeper claimed too early");
            }
        }
        _checkClaim(player, drawId, b);
    }

    function _checkClaim(address player, uint256 drawId, ClaimBefore memory b) internal {
        if (b.d.status != DailyDraw.Status.Settled) _flag(PAID_ONCE, "claim on unsettled draw");
        if (b.claimed) _flag(PAID_ONCE, "claimed twice");
        uint256 number = b.d.winningNumber;
        uint256 tickets = ticketsHeld[drawId][player][number];
        if (tickets == 0) _flag(PAID_ONCE, "claim without winning tickets");
        ++prizeClaims[drawId][player];
        ++referralCredits[drawId][player];
        ++timesPaid[drawId][player][number];

        uint256 prize = tickets * b.d.prizePerTicket;
        uint256 share = tickets * b.d.referralSharePerTicket;
        if (usdc.balanceOf(player) - b.player != prize) _flag(MONEY, "player got wrong prize");
        if (b.game - usdc.balanceOf(address(game)) != prize) _flag(MONEY, "claim paid out wrong");
        if (b.unclaimed - game.unclaimedWinnings() != prize + share) {
            _flag(MONEY, "claim released wrong unclaimed amount");
        }
        prizesPaid += prize;
        ++succeeded[b.active ? bytes32("claimActiveReferrer") : bytes32("claimNoReferrer")];
        prizesPaidFor[drawId] += prize;

        uint256 toTreasury = game.treasuryBalance() - b.treasuryBalance;
        if (b.active) {
            if (game.referralBalance(b.referrer) - b.referralBalance != share || toTreasury != 0) {
                _flag(MONEY, "active referrer not credited exactly");
            }
        } else if (toTreasury != share) {
            _flag(MONEY, "unearned referral share not sent to treasury");
        }
    }

    function _claimReferral(address who) internal {
        uint256 owedTo = game.referralBalance(who);
        uint256 total = game.totalReferralBalances();
        uint256 walletBefore = usdc.balanceOf(who);
        vm.prank(who);
        try game.claimReferral() {}
        catch {
            if (owedTo != 0) _flag(MONEY, "referral claim with a balance reverted");
            return;
        }
        uint256 got = usdc.balanceOf(who) - walletBefore;
        if (got != owedTo || owedTo == 0) _flag(MONEY, "referral paid wrong amount");
        if (game.referralBalance(who) != 0 || total - game.totalReferralBalances() != owedTo) {
            _flag(MONEY, "referral balance not cleared");
        }
        referralsPaid += got;
        ++succeeded["claimReferral"];
    }

    function _withdraw(bool isTreasury, address caller) internal {
        address to = isTreasury ? treasury : buyback;
        uint256 credited = isTreasury ? game.treasuryBalance() : game.buybackBalance();
        uint256 before = usdc.balanceOf(to);
        vm.prank(caller);
        if (isTreasury) {
            try game.withdrawTreasury() {}
            catch {
                if (credited != 0) _flag(MONEY, "treasury withdrawal with a balance reverted");
                return;
            }
        } else {
            try game.withdrawBuyback() {}
            catch {
                if (credited != 0) _flag(MONEY, "buy-back withdrawal with a balance reverted");
                return;
            }
        }
        uint256 got = usdc.balanceOf(to) - before;
        if (got != credited || credited == 0) _flag(MONEY, "withdrawal paid wrong amount");
        if (isTreasury) treasuryPaid += got;
        else buybackPaid += got;
        ++succeeded["withdraw"];
    }

    function _void(uint256 drawId, address caller) internal {
        DailyDraw.Draw memory d = game.getDraw(drawId);
        uint256 balanceBefore = usdc.balanceOf(address(game));
        uint256 rolloverBefore = game.rollover();
        vm.prank(caller);
        try game.voidDraw(drawId, "invariant") {}
        catch {
            return;
        }
        if (d.status != DailyDraw.Status.Closed) {
            _flag(WINNING, "voided a draw that wasn't closed");
        }
        if (caller != admin && block.timestamp < uint256(d.closedAt) + game.VOID_DELAY()) {
            _flag(WINNING, "non-admin voided before the delay");
        }
        if (usdc.balanceOf(address(game)) != balanceBefore || game.rollover() != rolloverBefore) {
            _flag(MONEY, "void moved money");
        }
        ++succeeded[caller == admin ? bytes32("voidByAdmin") : bytes32("voidByAnyone")];
    }

    function _refund(address player, uint256 drawId, uint16[] memory numbers) internal {
        DailyDraw.Draw memory d = game.getDraw(drawId);
        // Independent expectation: each played number not yet paid, once, however often listed.
        uint256 tickets;
        for (uint256 i; i < numbers.length; ++i) {
            uint256 n = numbers[i];
            bool repeat;
            for (uint256 j; j < i; ++j) {
                if (numbers[j] == n) repeat = true;
            }
            if (!repeat && timesPaid[drawId][player][n] == 0) {
                tickets += ticketsHeld[drawId][player][n];
            }
        }
        uint256 walletBefore = usdc.balanceOf(player);

        vm.prank(player);
        try game.refund(drawId, numbers) {}
        catch {
            if (d.status == DailyDraw.Status.Voided && tickets != 0) {
                _flag(MONEY, "refund owed but reverted");
            }
            return;
        }

        if (d.status != DailyDraw.Status.Voided) _flag(PAID_ONCE, "refund from a draw not voided");
        uint256 price = uint256(d.params.ticketPrice) * tickets;
        uint256 got = usdc.balanceOf(player) - walletBefore;
        if (got != price + price * d.params.feeBps / BPS || tickets == 0) {
            _flag(PAID_ONCE, "refund paid a wrong amount (double refund?)");
        }
        for (uint256 i; i < numbers.length; ++i) {
            uint256 n = numbers[i];
            if (ticketsHeld[drawId][player][n] != 0 && timesPaid[drawId][player][n] == 0) {
                timesPaid[drawId][player][n] = 1;
            }
        }
        ++refundsTo[drawId][player];
        refundsPaid += got;
        refundsPaidFor[drawId] += got;
        ++succeeded["refund"];
    }

    function _sweep(uint256 drawId, address caller) internal {
        DailyDraw.Draw memory d = game.getDraw(drawId);
        uint256 rolloverBefore = game.rollover();
        uint256 unclaimedBefore = game.unclaimedWinnings();
        uint256 balanceBefore = usdc.balanceOf(address(game));
        vm.prank(caller);
        try game.sweepUnclaimed(drawId) {}
        catch {
            return;
        }
        uint256 amount = (uint256(d.winningTickets) - d.claimedTickets)
            * (uint256(d.prizePerTicket) + d.referralSharePerTicket);
        if (d.status != DailyDraw.Status.Settled) _flag(PAID_ONCE, "swept a draw not settled");
        uint256 allowedFrom = uint256(d.settledAt) + uint256(d.params.unclaimedPrizeDays) * 1 days;
        if (block.timestamp < allowedFrom) _flag(MONEY, "swept before the claim window ended");
        if (
            amount == 0 || game.rollover() - rolloverBefore != amount
                || unclaimedBefore - game.unclaimedWinnings() != amount
        ) _flag(MONEY, "sweep moved a wrong amount");
        if (usdc.balanceOf(address(game)) != balanceBefore) _flag(MONEY, "sweep moved tokens");
        if (game.getDraw(drawId).status != DailyDraw.Status.Swept) _flag(PAID_ONCE, "not swept");
        ++succeeded["sweep"];
    }

    // =============================================================================================
    // Helpers
    // =============================================================================================

    function _flag(bytes32 category, string memory why) internal {
        if (bytes(violation[category]).length == 0) violation[category] = why;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return _actors[seed % _actors.length];
    }

    /// @dev The actor `offset` places after the one `seed` picks (no overflow on large seeds).
    function _actorAt(uint256 seed, uint256 offset) internal view returns (address) {
        uint256 n = _actors.length;
        return _actors[(seed % n + offset) % n];
    }

    /// @dev Another player, the outsider, the player themselves, or nobody.
    function _pickReferrer(address player, uint256 seed) internal view returns (address) {
        uint256 n = _actors.length;
        uint256 r = seed % (n + 3);
        if (r < n) return _actors[r];
        if (r == n) return outsider;
        if (r == n + 1) return player;
        return address(0);
    }

    function _pickNumbers(uint256 drawId, uint256 bundleSeed, uint256 numberSeed)
        internal
        view
        returns (uint16[] memory numbers)
    {
        uint256 count = [uint256(1), 2, 5, 10][bundleSeed % 4];
        if (bundleSeed % 40 == 39) count = 3; // not a bundle size: must revert
        uint256 range = game.getDraw(drawId).params.numberRange;
        if (range == 0) range = 100;
        // Mostly the low numbers, so draws often have winners (the value is biased the same way).
        uint256 span = numberSeed % 3 == 0 ? range : 4;
        numbers = new uint16[](count);
        for (uint256 i; i < count; ++i) {
            numbers[i] = uint16(uint256(keccak256(abi.encode(numberSeed, i))) % span);
        }
        if (numberSeed % 50 == 49) numbers[0] = uint16(range); // out of range: must revert
    }

    /// @dev The first (settled draw, player) with an unclaimed winning ticket, scanning from the
    ///      seeds; the given pair if there is none.
    function _findWinner(uint256 drawId, address player, uint256 drawSeed, uint256 actorSeed)
        internal
        view
        returns (uint256, address)
    {
        uint256 n = _closedDraws.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = _closedDraws[(drawSeed % n + i) % n];
            DailyDraw.Draw memory d = game.getDraw(id);
            if (d.status != DailyDraw.Status.Settled || d.winningTickets == d.claimedTickets) {
                continue;
            }
            for (uint256 j; j < _actors.length; ++j) {
                address a = _actorAt(actorSeed, j);
                if (ticketsHeld[id][a][d.winningNumber] != 0 && !game.claimed(id, a)) {
                    return (id, a);
                }
            }
        }
        return (drawId, player);
    }

    /// @dev The first (voided draw, player) with a ticket not yet refunded; the given pair if none.
    function _findVoidedPlayer(uint256 drawId, address player, uint256 drawSeed, uint256 actorSeed)
        internal
        view
        returns (uint256, address)
    {
        uint256 n = _closedDraws.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = _closedDraws[(drawSeed % n + i) % n];
            DailyDraw.Draw memory d = game.getDraw(id);
            if (d.status != DailyDraw.Status.Voided || d.refunded == uint256(d.sales) + d.fees) {
                continue;
            }
            for (uint256 j; j < _actors.length; ++j) {
                address a = _actorAt(actorSeed, j);
                if (refundsTo[id][a] == 0 && _numbersPlayed[id][a].length != 0) return (id, a);
            }
        }
        return (drawId, player);
    }

    function _biasValue(uint256 value) internal pure returns (uint256) {
        return value % 4 == 0 ? value : value % 4;
    }

    function _firstPending() internal view returns (uint256) {
        for (uint256 i; i < _closedDraws.length; ++i) {
            uint256 drawId = _closedDraws[i];
            if (game.getDraw(drawId).status == DailyDraw.Status.Closed) return drawId;
        }
        return 0;
    }
}
