// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {
    AccessControlUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
// OpenZeppelin 5.x keeps the guard in namespaced storage, so it is proxy-safe without an initializer.
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {IRandomnessConsumer, IRandomnessProvider} from "./interfaces/IRandomnessProvider.sol";

/// @title DailyDraw
/// @notice A daily number draw paid in USDC. Players pick numbers from 00 to 99, sales close at the
///         cutoff, and a verifiable random number picks the winning number.
///         Requirements v0.2 (C-01 to C-16) and Design v0.2 ("Smart contract specification").
/// @dev Scope so far: draws, bundles, fees, cutoff, referrer registration and randomness (#25);
///      settlement with the 65/15/20 split, referral credits and claims (#26); voiding with refunds,
///      sweeping unclaimed prizes, pausing and timelocked settings and upgrades (#27). No function
///      loops over winners or referrers; the only loops are over the caller's own numbers.
///
///      Roles. `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE` belong to the 2-of-3 Safe multisig;
///      `PARAMS_ROLE` and `UPGRADER_ROLE` belong to a 48-hour `TimelockController` that the
///      multisig proposes to (see script/DeployDailyDraw.s.sol). Both timelocked roles are
///      administered by `UPGRADER_ROLE`, so the multisig can't grant them to itself and skip the
///      delay.
///
///      Money flow. Each draw holds its sales and fees until it settles. Settlement takes the pool
///      (sales + the contract-level `rollover`), credits the team and buy-back shares and the draw's
///      fees to `treasuryBalance` / `buybackBalance`, and keeps prizes and referral shares in the
///      contract (`unclaimedWinnings`) until each winner claims. Referral shares are assigned at
///      claim time: to the winner's referrer if that referrer was active, otherwise to
///      `treasuryBalance`. Rounding dust joins the rollover. Settlement never transfers tokens, so
///      a frozen or broken treasury address can't make the randomness callback revert (a VRF
///      provider won't redeliver); `withdrawTreasury` / `withdrawBuyback` pay out separately.
contract DailyDraw is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard,
    IRandomnessConsumer
{
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    enum Status {
        None,
        Open,
        Closed,
        Drawn,
        Settled,
        Voided, // no random number arrived; tickets are refunded (#27)
        Swept // settled, and its unclaimed prizes moved into the rollover after the claim window
    }

    /// @notice Settings copied into each draw when it opens, so later changes only affect new draws.
    struct Params {
        uint128 ticketPrice; // USDC base units (6 decimals): 1_000_000 = $1
        uint16 feeBps; // fee on top of the price; never enters the pool
        uint16 numberRange; // 100 -> numbers 00..99
        uint16 winnersBps;
        uint16 teamBps;
        uint16 buybackBps;
        uint16 referrersBps;
        uint32 maxTicketsPerWallet; // per draw (one draw a day)
        uint32 drawInterval; // seconds between cutoffs: 1 day
        uint16 referrerActiveDays; // a referrer earns only if they played this many days before cutoff
        // Appended in #27: still fits the struct's second slot, so `Draw` and storage don't shift.
        uint16 unclaimedPrizeDays; // after settlement, unclaimed prizes may be swept to the rollover
    }

    struct Draw {
        Params params;
        uint64 cutoff;
        Status status;
        uint16 winningNumber;
        uint32 ticketCount;
        uint32 winningTickets;
        uint128 sales; // ticket prices only: the pool before rollover
        uint128 fees; // held until settlement, then sent to the treasury
        uint256 requestId;
        // Set at settlement (#26):
        uint128 pool; // sales + rollover brought in
        uint128 prizePerTicket; // winners' share per winning ticket
        uint128 referralSharePerTicket; // referral share attached to each winning ticket
        uint64 settledAt;
        uint32 claimedTickets; // winning tickets claimed so far
        // Appended in #27:
        uint64 closedAt; // when sales closed and randomness was requested
        uint128 refunded; // price + fee returned to players of a voided draw so far
    }

    // ---------------------------------------------------------------------------------------------
    // Roles and storage
    // ---------------------------------------------------------------------------------------------

    /// @notice Changes params for future draws. Granted to the 48-hour timelock (#27).
    bytes32 public constant PARAMS_ROLE = keccak256("PARAMS_ROLE");
    /// @notice Authorises upgrades. Granted to the 48-hour timelock (#27).
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    /// @notice May claim on a winner's behalf 24 hours after settlement; the money still goes to them.
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    /// @notice Pauses and unpauses buying and closing. Granted to the multisig (#27).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice How long winners have to claim themselves before a keeper may claim for them.
    uint256 public constant KEEPER_CLAIM_DELAY = 24 hours;
    /// @notice How long a closed draw may wait for its random number before anyone may void it.
    uint256 public constant VOID_DELAY = 24 hours;

    uint256 private constant BPS = 10_000;

    IERC20 public usdc;
    IRandomnessProvider public randomness;
    Params public params;
    uint256 public currentDrawId;

    mapping(uint256 drawId => Draw) internal _draws;
    mapping(uint256 drawId => mapping(uint256 number => uint256 tickets)) public ticketsPerNumber;
    mapping(
        uint256 drawId => mapping(address player => mapping(uint256 number => uint256 tickets))
    ) public ticketsOf;
    mapping(uint256 drawId => mapping(address player => uint256 tickets)) public ticketsBoughtBy;
    mapping(uint256 requestId => uint256 drawId) public drawForRequest;
    mapping(address player => address referrer) public referrerOf;
    mapping(address player => uint64 timestamp) public lastPlayed;

    // Added in #26 (appended; keep the order above unchanged for upgrades).

    /// @notice Team treasury: 10% of each won pool, every draw's fees, and unearned referral shares.
    address public treasury;
    /// @notice Buy-back reserve: 5% of each won pool, to buy back and burn the project token later.
    address public buybackReserve;
    /// @notice Pool carried into the next draw that settles: unwon pools and rounding dust.
    uint256 public rollover;
    /// @notice Prizes and referral shares of settled draws that winners have not claimed yet.
    uint256 public unclaimedWinnings;
    /// @notice Sum of all `referralBalance`s.
    uint256 public totalReferralBalances;
    mapping(address referrer => uint256 amount) public referralBalance;
    mapping(uint256 drawId => mapping(address player => bool)) public claimed;
    /// @dev Per player: draw id -> timestamp of their last purchase in that draw. Lets a claim ask
    ///      "when did this referrer last play before that draw's cutoff?" without loops over draws.
    mapping(address player => Checkpoints.Trace208) internal _plays;
    /// @notice Credited to the team treasury, waiting for `withdrawTreasury`.
    uint256 public treasuryBalance;
    /// @notice Credited to the buy-back reserve, waiting for `withdrawBuyback`.
    uint256 public buybackBalance;

    // Added in #27 (appended).

    /// @notice Numbers whose tickets `player` has been refunded in a voided draw.
    mapping(uint256 drawId => mapping(address player => mapping(uint256 number => bool))) public
        refunded;

    // ---------------------------------------------------------------------------------------------
    // Events and errors
    // ---------------------------------------------------------------------------------------------

    event DrawOpened(uint256 indexed drawId, uint64 cutoff);
    event TicketsBought(
        uint256 indexed drawId, address indexed player, uint16[] numbers, uint256 price, uint256 fee
    );
    event ReferrerSet(address indexed player, address indexed referrer);
    event DrawClosed(uint256 indexed drawId, uint256 requestId, uint256 ticketCount, uint256 sales);
    event DrawDrawn(uint256 indexed drawId, uint16 winningNumber, uint256 winningTickets);
    event ParamsChanged(Params params);
    event RandomnessProviderChanged(address provider);
    event DrawSettled(
        uint256 indexed drawId,
        uint256 pool,
        uint256 winningTickets,
        uint256 prizePerTicket,
        uint256 referralSharePerTicket,
        uint256 team,
        uint256 buyback,
        uint256 fees,
        uint256 rolloverOut
    );
    /// @notice `amount` carried to the next draw that settles: the whole pool if nobody won,
    ///         otherwise rounding dust.
    event RolledOver(uint256 indexed drawId, uint256 amount);
    event PrizeClaimed(
        uint256 indexed drawId,
        address indexed player,
        address caller,
        uint256 tickets,
        uint256 amount
    );
    event ReferralCredited(
        uint256 indexed drawId, address indexed referrer, address indexed player, uint256 amount
    );
    /// @notice A winner's referral share went to the treasury: no referrer, or not active.
    event ReferralShareToTreasury(uint256 indexed drawId, address indexed player, uint256 amount);
    event ReferralClaimed(address indexed referrer, uint256 amount);
    /// @notice Settlement (team share + fees) or an unearned referral share credited to the treasury.
    event TreasuryCredited(uint256 indexed drawId, uint256 amount);
    event BuybackCredited(uint256 indexed drawId, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event BuybackWithdrawn(address indexed to, uint256 amount);
    event TreasuryChanged(address treasury);
    event BuybackReserveChanged(address buybackReserve);
    event DrawVoided(uint256 indexed drawId, address indexed caller, string reason);
    event Refunded(uint256 indexed drawId, address indexed player, uint256 tickets, uint256 amount);
    /// @notice A random number arrived for a draw that was already voided; it was ignored.
    event LateRandomnessIgnored(uint256 indexed drawId, uint256 requestId);
    /// @notice Unclaimed prizes and their referral shares moved into the rollover.
    event UnclaimedSwept(uint256 indexed drawId, uint256 tickets, uint256 amount);

    error InvalidParams();
    error InvalidBundle(uint256 count);
    error InvalidNumber(uint256 number);
    error DrawNotOpen(uint256 drawId);
    error SalesClosed(uint256 drawId, uint64 cutoff);
    error CutoffNotReached(uint256 drawId, uint64 cutoff);
    error WalletLimitReached(uint256 limit);
    error NotRandomnessProvider();
    error UnknownRequest(uint256 requestId);
    error DrawNotSettled(uint256 drawId);
    error NothingToClaim();
    error AlreadyClaimed(uint256 drawId, address player);
    error KeeperClaimTooEarly(uint256 drawId, uint256 allowedFrom);
    error DrawNotClosed(uint256 drawId);
    error VoidTooEarly(uint256 drawId, uint256 allowedFrom);
    error DrawNotVoided(uint256 drawId);
    error NothingToRefund();
    error SweepTooEarly(uint256 drawId, uint256 allowedFrom);
    error NothingToSweep(uint256 drawId);

    // ---------------------------------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin_ The 2-of-3 Safe multisig: `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE`.
    /// @param timelock_ The 48-hour `TimelockController`: `PARAMS_ROLE` and `UPGRADER_ROLE`.
    /// @param treasury_ Team treasury (10% of won pools, fees, unearned referral shares).
    /// @param buybackReserve_ Buy-back reserve (5% of won pools).
    /// @param firstCutoff Timestamp at which sales for the first draw close (8:45pm WAT = 19:45 UTC).
    function initialize(
        address admin_,
        address timelock_,
        IERC20 usdc_,
        IRandomnessProvider randomness_,
        address treasury_,
        address buybackReserve_,
        Params calldata params_,
        uint64 firstCutoff
    ) external initializer {
        __AccessControl_init();
        __Pausable_init();
        _validate(params_);
        if (
            address(usdc_) == address(0) || address(randomness_) == address(0)
                || admin_ == address(0) || timelock_ == address(0) || treasury_ == address(0)
                || buybackReserve_ == address(0)
        ) {
            revert InvalidParams();
        }
        if (firstCutoff <= block.timestamp) revert InvalidParams();

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(PAUSER_ROLE, admin_);
        _grantRole(PARAMS_ROLE, timelock_);
        _grantRole(UPGRADER_ROLE, timelock_);
        // Only a holder of UPGRADER_ROLE (the timelock) can hand out the timelocked roles.
        _setRoleAdmin(PARAMS_ROLE, UPGRADER_ROLE);
        _setRoleAdmin(UPGRADER_ROLE, UPGRADER_ROLE);
        usdc = usdc_;
        randomness = randomness_;
        treasury = treasury_;
        buybackReserve = buybackReserve_;
        params = params_;
        _openDraw(1, firstCutoff);
    }

    // ---------------------------------------------------------------------------------------------
    // Playing
    // ---------------------------------------------------------------------------------------------

    /// @notice Buy 1, 2, 5 or 10 tickets for an open draw. Pulls (price + fee) x count in USDC, so
    ///         the caller must approve this contract first.
    /// @param referrer Recorded only on the caller's first ever purchase; ignored afterwards, and
    ///        never the caller themselves. Pass address(0) for none.
    function buyTickets(uint256 drawId, uint16[] calldata numbers, address referrer)
        external
        nonReentrant
        whenNotPaused
    {
        Draw storage d = _draws[drawId];
        if (d.status != Status.Open) revert DrawNotOpen(drawId);
        if (block.timestamp >= d.cutoff) revert SalesClosed(drawId, d.cutoff);

        uint256 count = numbers.length;
        if (count != 1 && count != 2 && count != 5 && count != 10) revert InvalidBundle(count);

        uint256 bought = ticketsBoughtBy[drawId][msg.sender] + count;
        if (bought > d.params.maxTicketsPerWallet) {
            revert WalletLimitReached(d.params.maxTicketsPerWallet);
        }
        ticketsBoughtBy[drawId][msg.sender] = bought;

        uint256 range = d.params.numberRange;
        for (uint256 i; i < count; ++i) {
            uint256 n = numbers[i];
            if (n >= range) revert InvalidNumber(n);
            ++ticketsPerNumber[drawId][n];
            ++ticketsOf[drawId][msg.sender][n];
        }

        uint256 price = uint256(d.params.ticketPrice) * count;
        uint256 fee = price * d.params.feeBps / BPS;
        d.sales += uint128(price);
        d.fees += uint128(fee);
        d.ticketCount += uint32(count);

        if (lastPlayed[msg.sender] == 0 && referrer != address(0) && referrer != msg.sender) {
            referrerOf[msg.sender] = referrer;
            emit ReferrerSet(msg.sender, referrer);
        }
        _recordPlay(msg.sender, drawId);

        emit TicketsBought(drawId, msg.sender, numbers, price, fee);
        usdc.safeTransferFrom(msg.sender, address(this), price + fee);
    }

    // ---------------------------------------------------------------------------------------------
    // Drawing
    // ---------------------------------------------------------------------------------------------

    /// @notice Close sales once the cutoff has passed and ask for a random number. Anyone can call
    ///         it, so a stuck keeper can't stall the game. Opens the next draw straight away.
    function closeDraw(uint256 drawId) external nonReentrant whenNotPaused {
        Draw storage d = _draws[drawId];
        if (d.status != Status.Open) revert DrawNotOpen(drawId);
        if (block.timestamp < d.cutoff) revert CutoffNotReached(drawId, d.cutoff);

        d.status = Status.Closed;
        d.closedAt = uint64(block.timestamp);
        _openDraw(drawId + 1, _nextCutoff(d.cutoff, d.params.drawInterval));

        uint256 requestId = randomness.requestRandomness();
        d.requestId = requestId;
        drawForRequest[requestId] = drawId;
        emit DrawClosed(drawId, requestId, d.ticketCount, d.sales);
    }

    /// @inheritdoc IRandomnessConsumer
    /// @dev Only the randomness provider, which has already verified the proof. Settles the draw in
    ///      the same call: constant work, no loops and no token transfers. A number that arrives
    ///      after its draw was voided is ignored (not reverted), so a provider never sees a failure.
    function fulfillRandomness(uint256 requestId, uint256 value) external {
        if (msg.sender != address(randomness)) revert NotRandomnessProvider();
        uint256 drawId = drawForRequest[requestId];
        Draw storage d = _draws[drawId];
        if (drawId != 0 && d.status == Status.Voided && d.requestId == requestId) {
            emit LateRandomnessIgnored(drawId, requestId);
            return;
        }
        if (drawId == 0 || d.status != Status.Closed || d.requestId != requestId) {
            revert UnknownRequest(requestId);
        }

        uint16 winning = uint16(value % d.params.numberRange);
        d.winningNumber = winning;
        d.winningTickets = uint32(ticketsPerNumber[drawId][winning]);
        d.status = Status.Drawn;
        emit DrawDrawn(drawId, winning, d.winningTickets);

        _settle(drawId, d);
    }

    // ---------------------------------------------------------------------------------------------
    // Claims
    // ---------------------------------------------------------------------------------------------

    /// @notice Claim the prize for your tickets on the winning number of a settled draw.
    /// @param numbers The numbers you played; must include the winning number. Kept as a list so a
    ///        wallet can pass everything it played without first checking which number won.
    function claim(uint256 drawId, uint16[] calldata numbers) external nonReentrant {
        Draw storage d = _draws[drawId];
        if (d.status != Status.Settled) revert DrawNotSettled(drawId);
        bool holdsWinning;
        for (uint256 i; i < numbers.length; ++i) {
            if (numbers[i] == d.winningNumber) {
                holdsWinning = true;
                break;
            }
        }
        if (!holdsWinning) revert NothingToClaim();
        _claim(drawId, d, msg.sender);
    }

    /// @notice Claim for a winner who hasn't, from 24 hours after settlement. Keeper only; the prize
    ///         goes to `player`, never to the caller.
    function claimFor(address player, uint256 drawId) external nonReentrant onlyRole(KEEPER_ROLE) {
        Draw storage d = _draws[drawId];
        if (d.status != Status.Settled) revert DrawNotSettled(drawId);
        uint256 allowedFrom = uint256(d.settledAt) + KEEPER_CLAIM_DELAY;
        if (block.timestamp < allowedFrom) revert KeeperClaimTooEarly(drawId, allowedFrom);
        _claim(drawId, d, player);
    }

    /// @notice Withdraw the referral shares credited to the caller.
    function claimReferral() external nonReentrant {
        uint256 amount = referralBalance[msg.sender];
        if (amount == 0) revert NothingToClaim();
        referralBalance[msg.sender] = 0;
        totalReferralBalances -= amount;
        emit ReferralClaimed(msg.sender, amount);
        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Send the treasury's credited balance to the current `treasury`. Anyone may call it;
    ///         the money only ever goes to that address.
    function withdrawTreasury() external nonReentrant {
        uint256 amount = treasuryBalance;
        if (amount == 0) revert NothingToClaim();
        treasuryBalance = 0;
        address to = treasury;
        emit TreasuryWithdrawn(to, amount);
        usdc.safeTransfer(to, amount);
    }

    /// @notice Send the buy-back reserve's credited balance to the current `buybackReserve`.
    ///         Anyone may call it; the money only ever goes to that address.
    function withdrawBuyback() external nonReentrant {
        uint256 amount = buybackBalance;
        if (amount == 0) revert NothingToClaim();
        buybackBalance = 0;
        address to = buybackReserve;
        emit BuybackWithdrawn(to, amount);
        usdc.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Void, refund, sweep (#27)
    // ---------------------------------------------------------------------------------------------

    /// @notice Void a closed draw whose random number hasn't arrived, so its players can be
    ///         refunded. The admin may do it at any time while the draw waits; anyone may once it has
    ///         waited `VOID_DELAY` (24 hours). The draw's sales and fees never reach the pool or the
    ///         treasury; the rollover is untouched and goes to the next draw that settles.
    function voidDraw(uint256 drawId, string calldata reason) external {
        Draw storage d = _draws[drawId];
        if (d.status != Status.Closed) revert DrawNotClosed(drawId);
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            uint256 allowedFrom = uint256(d.closedAt) + VOID_DELAY;
            if (block.timestamp < allowedFrom) revert VoidTooEarly(drawId, allowedFrom);
        }
        d.status = Status.Voided;
        emit DrawVoided(drawId, msg.sender, reason);
    }

    /// @notice Refund the caller's tickets on `numbers` in a voided draw: price plus fee for each.
    ///         Each number is refunded once; numbers already refunded or never played are skipped,
    ///         so a wallet can pass everything it played. Works while paused.
    function refund(uint256 drawId, uint16[] calldata numbers) external nonReentrant {
        Draw storage d = _draws[drawId];
        if (d.status != Status.Voided) revert DrawNotVoided(drawId);
        uint256 tickets;
        for (uint256 i; i < numbers.length; ++i) {
            uint256 n = numbers[i];
            if (refunded[drawId][msg.sender][n]) continue;
            uint256 t = ticketsOf[drawId][msg.sender][n];
            if (t == 0) continue;
            refunded[drawId][msg.sender][n] = true;
            tickets += t;
        }
        if (tickets == 0) revert NothingToRefund();
        // Exact: `_validate` makes the fee on a bundle equal the per-ticket fee times its size.
        uint256 price = uint256(d.params.ticketPrice) * tickets;
        uint256 amount = price + price * d.params.feeBps / BPS;
        d.refunded += uint128(amount);
        emit Refunded(drawId, msg.sender, tickets, amount);
        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Once a settled draw's claim window (`unclaimedPrizeDays` after settlement) has
    ///         passed, move its unclaimed prizes and their referral shares into the rollover, so they
    ///         join the next pool that settles. Anyone may call it. Claims for the draw revert after.
    function sweepUnclaimed(uint256 drawId) external {
        Draw storage d = _draws[drawId];
        if (d.status != Status.Settled) revert DrawNotSettled(drawId);
        uint256 allowedFrom = uint256(d.settledAt) + uint256(d.params.unclaimedPrizeDays) * 1 days;
        if (block.timestamp < allowedFrom) revert SweepTooEarly(drawId, allowedFrom);
        uint256 tickets = uint256(d.winningTickets) - d.claimedTickets;
        if (tickets == 0) revert NothingToSweep(drawId);

        uint256 amount = tickets * (uint256(d.prizePerTicket) + d.referralSharePerTicket);
        d.status = Status.Swept;
        unclaimedWinnings -= amount;
        rollover += amount;
        emit UnclaimedSwept(drawId, tickets, amount);
        emit RolledOver(drawId, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    /// @notice Stop buying and closing. Claims, referral claims, refunds, voiding, sweeping and
    ///         treasury/buy-back withdrawals keep working, and so does a pending randomness callback.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice New params apply from the next draw that opens; open draws keep their own copy.
    function setParams(Params calldata params_) external onlyRole(PARAMS_ROLE) {
        _validate(params_);
        params = params_;
        emit ParamsChanged(params_);
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert InvalidParams();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    function setBuybackReserve(address buybackReserve_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (buybackReserve_ == address(0)) revert InvalidParams();
        buybackReserve = buybackReserve_;
        emit BuybackReserveChanged(buybackReserve_);
    }

    /// @notice Timelocked like params: whoever picks the provider could pick the winning number.
    ///         Draws waiting on a broken provider are voided and refunded in the meantime.
    function setRandomnessProvider(IRandomnessProvider provider) external onlyRole(PARAMS_ROLE) {
        if (address(provider) == address(0)) revert InvalidParams();
        randomness = provider;
        emit RandomnessProviderChanged(address(provider));
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function getDraw(uint256 drawId) external view returns (Draw memory) {
        return _draws[drawId];
    }

    /// @notice Winning tickets `player` holds in a settled draw and has not claimed (0 otherwise).
    function claimable(uint256 drawId, address player)
        external
        view
        returns (uint256 tickets, uint256 prize)
    {
        Draw storage d = _draws[drawId];
        if (d.status != Status.Settled || claimed[drawId][player]) return (0, 0);
        tickets = ticketsOf[drawId][player][d.winningNumber];
        prize = tickets * d.prizePerTicket;
    }

    /// @notice Whether `referrer` counts as active for `drawId`: they bought a ticket within
    ///         `referrerActiveDays` before that draw's cutoff.
    function isActiveReferrer(address referrer, uint256 drawId) public view returns (bool) {
        if (referrer == address(0)) return false;
        // Purchases in draws up to `drawId` all happened before its cutoff; later draws open only
        // once it has closed, so their purchases are never counted.
        uint256 played = Checkpoints.upperLookupRecent(_plays[referrer], uint48(drawId));
        if (played == 0) return false;
        Draw storage d = _draws[drawId];
        return played + uint256(d.params.referrerActiveDays) * 1 days >= d.cutoff;
    }

    /// @notice What a player pays for `count` tickets in the given draw.
    function quote(uint256 drawId, uint256 count)
        external
        view
        returns (uint256 price, uint256 fee)
    {
        Params storage p = _draws[drawId].params;
        price = uint256(p.ticketPrice) * count;
        fee = price * p.feeBps / BPS;
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _recordPlay(address player, uint256 drawId) internal {
        lastPlayed[player] = uint64(block.timestamp);
        Checkpoints.push(_plays[player], uint48(drawId), uint208(block.timestamp));
    }

    /// @dev Matches packages/shared/src/settlement.ts. Unlike the reference, the referral shares of
    ///      tickets without an active referrer are not known here (no loops over winners); they are
    ///      assigned at claim time, so totals match once every winner has claimed.
    function _settle(uint256 drawId, Draw storage d) private {
        uint256 pool = uint256(d.sales) + rollover;
        uint256 fees = d.fees;
        uint256 w = d.winningTickets;
        Params storage p = d.params;

        d.pool = uint128(pool);
        d.settledAt = uint64(block.timestamp);
        d.status = Status.Settled;

        uint256 team;
        uint256 buyback;
        uint256 rolloverOut;
        if (w == 0) {
            rolloverOut = pool;
        } else {
            uint256 prize = pool * p.winnersBps / BPS / w;
            uint256 share = pool * p.referrersBps / BPS / w;
            team = pool * p.teamBps / BPS;
            buyback = pool * p.buybackBps / BPS;
            uint256 owedToWinners = (prize + share) * w;
            rolloverOut = pool - owedToWinners - team - buyback;
            d.prizePerTicket = uint128(prize);
            d.referralSharePerTicket = uint128(share);
            unclaimedWinnings += owedToWinners;
        }
        rollover = rolloverOut;

        emit DrawSettled(
            drawId,
            pool,
            w,
            d.prizePerTicket,
            d.referralSharePerTicket,
            team,
            buyback,
            fees,
            rolloverOut
        );
        if (rolloverOut != 0) emit RolledOver(drawId, rolloverOut);

        if (team + fees != 0) {
            treasuryBalance += team + fees;
            emit TreasuryCredited(drawId, team + fees);
        }
        if (buyback != 0) {
            buybackBalance += buyback;
            emit BuybackCredited(drawId, buyback);
        }
    }

    function _claim(uint256 drawId, Draw storage d, address player) private {
        if (claimed[drawId][player]) revert AlreadyClaimed(drawId, player);
        uint256 tickets = ticketsOf[drawId][player][d.winningNumber];
        if (tickets == 0) revert NothingToClaim();
        claimed[drawId][player] = true;
        d.claimedTickets += uint32(tickets);

        uint256 prize = tickets * d.prizePerTicket;
        uint256 share = tickets * d.referralSharePerTicket;
        unclaimedWinnings -= prize + share;

        address referrer = referrerOf[player];
        bool toTreasury = !isActiveReferrer(referrer, drawId);
        if (toTreasury) {
            treasuryBalance += share;
            emit ReferralShareToTreasury(drawId, player, share);
            emit TreasuryCredited(drawId, share);
        } else {
            referralBalance[referrer] += share;
            totalReferralBalances += share;
            emit ReferralCredited(drawId, referrer, player, share);
        }
        emit PrizeClaimed(drawId, player, msg.sender, tickets, prize);

        if (prize != 0) usdc.safeTransfer(player, prize);
    }

    function _openDraw(uint256 drawId, uint64 cutoff) private {
        Draw storage d = _draws[drawId];
        d.params = params;
        d.cutoff = cutoff;
        d.status = Status.Open;
        currentDrawId = drawId;
        emit DrawOpened(drawId, cutoff);
    }

    /// @dev The next cutoff after `cutoff` that is still in the future, so missed days are skipped.
    function _nextCutoff(uint64 cutoff, uint32 interval) private view returns (uint64) {
        uint256 next = uint256(cutoff) + interval;
        if (next <= block.timestamp) {
            uint256 missed = (block.timestamp - cutoff) / interval;
            next = uint256(cutoff) + (missed + 1) * interval;
        }
        return uint64(next);
    }

    function _validate(Params calldata p) private pure {
        if (
            p.ticketPrice == 0 || p.feeBps > 2_000 || p.numberRange < 10 || p.numberRange > 1_000
                || uint256(p.winnersBps) + p.teamBps + p.buybackBps + p.referrersBps != BPS
                || p.maxTicketsPerWallet < 10 || p.drawInterval < 1 hours
                || p.referrerActiveDays == 0 || p.referrerActiveDays > 365
                || p.unclaimedPrizeDays == 0 || p.unclaimedPrizeDays > 365
                // Whole fee per ticket, so a bundle's fee is exactly the sum of its tickets' fees
                // and a refund returns exactly what was paid.
                || uint256(p.ticketPrice) * p.feeBps % BPS != 0
        ) {
            revert InvalidParams();
        }
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
