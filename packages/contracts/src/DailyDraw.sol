// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {
    AccessControlUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
// OpenZeppelin 5.x keeps the guard in namespaced storage, so it is proxy-safe without an initializer.
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRandomnessConsumer, IRandomnessProvider} from "./interfaces/IRandomnessProvider.sol";

/// @title DailyDraw
/// @notice A daily number draw paid in USDC. Players pick numbers from 00 to 99, sales close at the
///         cutoff, and a verifiable random number picks the winning number.
///         Requirements v0.2 (C-01 to C-16) and Design v0.2 ("Smart contract specification").
/// @dev Scope of this version (ticket #25): draws, bundles, fees, cutoff, referrer registration and
///      randomness. Settlement and claims (#26), void/refund/sweep/pause and timelocked upgrades (#27)
///      build on it. No function loops over tickets, winners or referrers.
contract DailyDraw is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
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
        Drawn
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
    }

    struct Draw {
        Params params;
        uint64 cutoff;
        Status status;
        uint16 winningNumber;
        uint32 ticketCount;
        uint32 winningTickets;
        uint128 sales; // ticket prices only: the pool before rollover
        uint128 fees; // held until settlement (#26), then sent to the treasury
        uint256 requestId;
    }

    // ---------------------------------------------------------------------------------------------
    // Roles and storage
    // ---------------------------------------------------------------------------------------------

    /// @notice Changes params for future draws. Granted to the 48-hour timelock (#27).
    bytes32 public constant PARAMS_ROLE = keccak256("PARAMS_ROLE");
    /// @notice Authorises upgrades. Granted to the 48-hour timelock (#27).
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    uint256 private constant BPS = 10_000;

    IERC20 public usdc;
    IRandomnessProvider public randomness;
    Params public params;
    uint256 public currentDrawId;

    mapping(uint256 drawId => Draw) private _draws;
    mapping(uint256 drawId => mapping(uint256 number => uint256 tickets)) public ticketsPerNumber;
    mapping(
        uint256 drawId => mapping(address player => mapping(uint256 number => uint256 tickets))
    ) public ticketsOf;
    mapping(uint256 drawId => mapping(address player => uint256 tickets)) public ticketsBoughtBy;
    mapping(uint256 requestId => uint256 drawId) public drawForRequest;
    mapping(address player => address referrer) public referrerOf;
    mapping(address player => uint64 timestamp) public lastPlayed;

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

    error InvalidParams();
    error InvalidBundle(uint256 count);
    error InvalidNumber(uint256 number);
    error DrawNotOpen(uint256 drawId);
    error SalesClosed(uint256 drawId, uint64 cutoff);
    error CutoffNotReached(uint256 drawId, uint64 cutoff);
    error WalletLimitReached(uint256 limit);
    error NotRandomnessProvider();
    error UnknownRequest(uint256 requestId);

    // ---------------------------------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin_ The 2-of-3 Safe multisig.
    /// @param firstCutoff Timestamp at which sales for the first draw close (8:45pm WAT = 19:45 UTC).
    function initialize(
        address admin_,
        IERC20 usdc_,
        IRandomnessProvider randomness_,
        Params calldata params_,
        uint64 firstCutoff
    ) external initializer {
        __AccessControl_init();
        _validate(params_);
        if (
            address(usdc_) == address(0) || address(randomness_) == address(0)
                || admin_ == address(0)
        ) {
            revert InvalidParams();
        }
        if (firstCutoff <= block.timestamp) revert InvalidParams();

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(PARAMS_ROLE, admin_);
        _grantRole(UPGRADER_ROLE, admin_);
        usdc = usdc_;
        randomness = randomness_;
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
        lastPlayed[msg.sender] = uint64(block.timestamp);

        emit TicketsBought(drawId, msg.sender, numbers, price, fee);
        usdc.safeTransferFrom(msg.sender, address(this), price + fee);
    }

    // ---------------------------------------------------------------------------------------------
    // Drawing
    // ---------------------------------------------------------------------------------------------

    /// @notice Close sales once the cutoff has passed and ask for a random number. Anyone can call
    ///         it, so a stuck keeper can't stall the game. Opens the next draw straight away.
    function closeDraw(uint256 drawId) external nonReentrant {
        Draw storage d = _draws[drawId];
        if (d.status != Status.Open) revert DrawNotOpen(drawId);
        if (block.timestamp < d.cutoff) revert CutoffNotReached(drawId, d.cutoff);

        d.status = Status.Closed;
        _openDraw(drawId + 1, _nextCutoff(d.cutoff, d.params.drawInterval));

        uint256 requestId = randomness.requestRandomness();
        d.requestId = requestId;
        drawForRequest[requestId] = drawId;
        emit DrawClosed(drawId, requestId, d.ticketCount, d.sales);
    }

    /// @inheritdoc IRandomnessConsumer
    /// @dev Only the randomness provider, which has already verified the proof. Settlement (#26) runs
    ///      after this.
    function fulfillRandomness(uint256 requestId, uint256 value) external {
        if (msg.sender != address(randomness)) revert NotRandomnessProvider();
        uint256 drawId = drawForRequest[requestId];
        Draw storage d = _draws[drawId];
        if (drawId == 0 || d.status != Status.Closed || d.requestId != requestId) {
            revert UnknownRequest(requestId);
        }

        uint16 winning = uint16(value % d.params.numberRange);
        d.winningNumber = winning;
        d.winningTickets = uint32(ticketsPerNumber[drawId][winning]);
        d.status = Status.Drawn;
        emit DrawDrawn(drawId, winning, d.winningTickets);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    /// @notice New params apply from the next draw that opens; open draws keep their own copy.
    function setParams(Params calldata params_) external onlyRole(PARAMS_ROLE) {
        _validate(params_);
        params = params_;
        emit ParamsChanged(params_);
    }

    function setRandomnessProvider(IRandomnessProvider provider)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
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
        ) revert InvalidParams();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
