// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DailyDraw} from "../src/DailyDraw.sol";

/// Changes the ticket fee on a deployed Daily Draw through its timelock (#44: 10% -> 2%). It reads
/// the live params and changes only `feeBps`, so every other setting stays as it is.
///
/// A timelocked change takes two transactions from the Admin wallet (timelock proposer and
/// executor), at least the timelock's delay apart (1 hour on the testnet):
///   schedule()  schedules `setParams(<live params with the new fee>)` on the timelock
///   execute()   executes it once the delay has passed
///   status()    shows the live fee and the change's state; sends nothing
/// The draw that is open when the change executes keeps its fee: each draw copies the params
/// when it opens, so the new fee applies from the next draw.
///
/// Run it with `pnpm testnet:set-fee` (scripts/set-fee.sh), which reads the repo's `.env`; see
/// docs/testnet-runbook.md. Env:
///   ADMIN_PRIVATE_KEY  the Admin wallet's key; without it forge's `--sender` signs (local tests)
///   FEE_BPS            the new fee in basis points (default 200 = 2%)
///   TESTNET_NETWORK    deployment file to read the addresses from (default "base-sepolia")
contract SetFee is Script {
    uint16 public constant DEFAULT_FEE_BPS = 200;

    error FeeAlreadySet(uint16 feeBps);
    error AlreadyScheduled(bytes32 id, uint256 readyAt);
    error NotScheduled(uint16 feeBps);
    error NotReadyYet(bytes32 id, uint256 readyAt);
    error NotTheTimelockAdmin(address account, bytes32 role);
    error FeeNotApplied(uint16 feeBps);

    /// @notice The timelock call: target, data and salt (predecessor 0, value 0).
    struct Change {
        DailyDraw game;
        TimelockController timelock;
        bytes data;
        bytes32 salt;
        bytes32 id;
    }

    // ---------------------------------------------------------------------------------------------
    // Entry points (forge script ... --sig "schedule()")
    // ---------------------------------------------------------------------------------------------

    function schedule() external {
        (DailyDraw game, TimelockController timelock) = addresses();
        uint16 fee = feeFromEnv();
        _report(game, fee);
        _checkAccepted(game, timelock, fee);
        _startBroadcast();
        Change memory c = scheduleChange(game, timelock, fee);
        vm.stopBroadcast();
        uint256 readyAt = timelock.getTimestamp(c.id);
        console.log("Scheduled: setParams with feeBps %s, operation", fee);
        console.logBytes32(c.id);
        console.log(
            "Executable %s seconds after it is mined (about unix time %s).",
            timelock.getMinDelay(),
            readyAt
        );
        console.log("`pnpm testnet:set-fee status` shows when; then: pnpm testnet:set-fee execute");
    }

    function execute() external {
        (DailyDraw game, TimelockController timelock) = addresses();
        uint16 fee = feeFromEnv();
        _report(game, fee);
        _startBroadcast();
        executeChange(game, timelock, fee);
        vm.stopBroadcast();
        console.log("Executed: the live feeBps is now %s.", fee);
        console.log(
            "Draw #%s keeps its own fee; the next draw opens with the new one.",
            game.currentDrawId()
        );
    }

    function status() external view {
        (DailyDraw game, TimelockController timelock) = addresses();
        uint16 fee = feeFromEnv();
        _report(game, fee);
        (,, uint16 liveFee,) = _live(game);
        if (liveFee == fee) {
            console.log("The live fee is already %s bps: nothing to schedule.", fee);
            return;
        }
        (bytes32 id,, TimelockController.OperationState state) = findChange(game, timelock, fee);
        if (state == TimelockController.OperationState.Unset) {
            console.log("Not scheduled yet. Next: pnpm testnet:set-fee schedule");
        } else if (state == TimelockController.OperationState.Waiting) {
            console.log(
                "Scheduled, waiting: executable from unix time %s (now %s).",
                timelock.getTimestamp(id),
                block.timestamp
            );
        } else {
            console.log("Scheduled and ready. Next: pnpm testnet:set-fee execute");
        }
    }

    // ---------------------------------------------------------------------------------------------
    // The change itself (public so tests can call it against a local deployment)
    // ---------------------------------------------------------------------------------------------

    /// @notice The live params with only `feeBps` replaced, and the `setParams` call for them.
    function changeData(DailyDraw game, uint16 fee)
        public
        view
        returns (DailyDraw.Params memory p, bytes memory data)
    {
        p = liveParams(game);
        p.feeBps = fee;
        data = abi.encodeCall(DailyDraw.setParams, (p));
    }

    /// @notice Schedules the change with the timelock's minimum delay. Reverts if the fee is
    ///         already live, the same change is already waiting, or the params would be rejected.
    function scheduleChange(DailyDraw game, TimelockController timelock, uint16 fee)
        public
        returns (Change memory c)
    {
        if (liveParams(game).feeBps == fee) revert FeeAlreadySet(fee);
        (, c.data) = changeData(game, fee);
        (c.game, c.timelock) = (game, timelock);
        // A fee change can be repeated (10% -> 2% -> 10% -> 2%): findChange skips used salts.
        TimelockController.OperationState state;
        (c.id, c.salt, state) = findChange(game, timelock, fee);
        if (state != TimelockController.OperationState.Unset) {
            revert AlreadyScheduled(c.id, timelock.getTimestamp(c.id));
        }
        timelock.schedule(address(game), 0, c.data, bytes32(0), c.salt, timelock.getMinDelay());
    }

    /// @notice Executes the scheduled change once its delay has passed, and checks it applied.
    function executeChange(DailyDraw game, TimelockController timelock, uint16 fee)
        public
        returns (Change memory c)
    {
        if (liveParams(game).feeBps == fee) revert FeeAlreadySet(fee);
        (, c.data) = changeData(game, fee);
        (c.game, c.timelock) = (game, timelock);
        TimelockController.OperationState state;
        (c.id, c.salt, state) = findChange(game, timelock, fee);
        if (state == TimelockController.OperationState.Unset) revert NotScheduled(fee);
        if (state == TimelockController.OperationState.Waiting) {
            revert NotReadyYet(c.id, timelock.getTimestamp(c.id));
        }
        timelock.execute(address(game), 0, c.data, bytes32(0), c.salt);
        if (liveParams(game).feeBps != fee) revert FeeNotApplied(fee);
    }

    /// @notice The first operation for this change that hasn't been executed: its id, salt and
    ///         state (Unset if there is none).
    function findChange(DailyDraw game, TimelockController timelock, uint16 fee)
        public
        view
        returns (bytes32 id, bytes32 salt, TimelockController.OperationState state)
    {
        (, bytes memory data) = changeData(game, fee);
        for (;; salt = bytes32(uint256(salt) + 1)) {
            id = timelock.hashOperation(address(game), 0, data, bytes32(0), salt);
            state = timelock.getOperationState(id);
            if (state != TimelockController.OperationState.Done) return (id, salt, state);
        }
    }

    /// @notice The params new draws will copy. The public getter returns the struct's 11 fields
    ///         as a tuple, which ABI-encodes exactly like the (all static) struct.
    function liveParams(DailyDraw game) public view returns (DailyDraw.Params memory) {
        (bool ok, bytes memory ret) = address(game).staticcall(abi.encodeCall(game.params, ()));
        require(ok, "params() failed");
        return abi.decode(ret, (DailyDraw.Params));
    }

    // ---------------------------------------------------------------------------------------------
    // Environment
    // ---------------------------------------------------------------------------------------------

    /// @notice DailyDraw and timelock addresses from `deployments/<TESTNET_NETWORK>.json`.
    function addresses() public view returns (DailyDraw game, TimelockController timelock) {
        string memory network = vm.envOr("TESTNET_NETWORK", string("base-sepolia"));
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));
        game = DailyDraw(vm.parseJsonAddress(json, ".dailyDraw"));
        timelock = TimelockController(payable(vm.parseJsonAddress(json, ".timelock")));
    }

    function feeFromEnv() public view returns (uint16) {
        return uint16(vm.envOr("FEE_BPS", uint256(DEFAULT_FEE_BPS)));
    }

    function _startBroadcast() internal {
        uint256 key = vm.envOr("ADMIN_PRIVATE_KEY", uint256(0));
        if (key == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(key);
        }
        (, address sender,) = vm.readCallers();
        _checkRoles(sender);
    }

    function _checkRoles(address sender) internal view {
        (, TimelockController timelock) = addresses();
        bytes32[2] memory roles = [timelock.PROPOSER_ROLE(), timelock.EXECUTOR_ROLE()];
        for (uint256 i; i < 2; ++i) {
            if (!timelock.hasRole(roles[i], sender)) revert NotTheTimelockAdmin(sender, roles[i]);
        }
    }

    /// @dev Tries the new params as the timelock would, then undoes it, so a fee the contract
    ///      rejects (over 20%, or not a whole unit per ticket) fails now rather than after the wait.
    function _checkAccepted(DailyDraw game, TimelockController timelock, uint16 fee) internal {
        (DailyDraw.Params memory p,) = changeData(game, fee);
        uint256 snapshot = vm.snapshotState();
        vm.prank(address(timelock));
        game.setParams(p);
        vm.revertToState(snapshot);
    }

    function _report(DailyDraw game, uint16 fee) internal view {
        (uint256 drawId, uint16 drawFee, uint16 liveFee, uint256 price) = _live(game);
        console.log("DailyDraw %s, open draw #%s", address(game), drawId);
        console.log("  open draw's fee: %s bps (keeps it until it closes)", drawFee);
        console.log("  live params fee: %s bps -> new fee: %s bps", liveFee, fee);
        console.log(
            "  next draws charge %s + %s USDC base units a ticket", price, price * fee / 1e4
        );
    }

    function _live(DailyDraw game)
        internal
        view
        returns (uint256 drawId, uint16 drawFee, uint16 liveFee, uint256 price)
    {
        drawId = game.currentDrawId();
        drawFee = game.getDraw(drawId).params.feeBps;
        DailyDraw.Params memory p = liveParams(game);
        (liveFee, price) = (p.feeBps, p.ticketPrice);
    }
}
