// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {DeployDailyDraw} from "../script/DeployDailyDraw.s.sol";
import {SetFee} from "../script/SetFee.s.sol";
import {MockRandomness, MockUSDC} from "./mocks/Mocks.sol";

/// @notice The live fee change (#44) through the timelock: schedule, wait, execute. The script
///         contract stands in for the Admin wallet (timelock proposer and executor).
contract SetFeeTest is Test {
    SetFee internal script;
    DailyDraw internal game;
    TimelockController internal timelock;
    MockRandomness internal rng;
    DailyDraw.Params internal before;

    uint256 internal constant DELAY = 1 hours;

    function setUp() public {
        vm.warp(1_800_000_000);
        script = new SetFee();
        rng = new MockRandomness();
        DeployDailyDraw deployer = new DeployDailyDraw();
        before = deployer.defaultParams();
        before.feeBps = 1_000; // like the live testnet before #44
        (game, timelock) = deployer.deploy(
            DeployDailyDraw.Config({
                multisig: address(script),
                usdc: new MockUSDC(),
                randomness: rng,
                treasury: makeAddr("treasury"),
                buybackReserve: makeAddr("buyback"),
                params: before,
                firstCutoff: uint64(block.timestamp + 12 hours)
            }),
            DELAY
        );
    }

    function test_ChangesOnlyTheFeeAfterTheDelay() public {
        assertEq(script.DEFAULT_FEE_BPS(), 200);
        (DailyDraw.Params memory p, bytes memory data) = script.changeData(game, 200);
        assertEq(p.feeBps, 200);
        assertEq(data, abi.encodeCall(DailyDraw.setParams, (p)));
        p.feeBps = before.feeBps;
        assertEq(abi.encode(p), abi.encode(before)); // nothing else changes

        SetFee.Change memory c = script.scheduleChange(game, timelock, 200);
        assertEq(c.salt, bytes32(0));
        assertTrue(timelock.isOperationPending(c.id));
        assertEq(timelock.getTimestamp(c.id), block.timestamp + DELAY);
        assertEq(script.liveParams(game).feeBps, 1_000); // nothing changes yet

        (bytes32 id, bytes32 salt, TimelockController.OperationState state) =
            script.findChange(game, timelock, 200);
        assertEq(id, c.id);
        assertEq(salt, c.salt);
        assertEq(uint8(state), uint8(TimelockController.OperationState.Waiting));

        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert(
            abi.encodeWithSelector(SetFee.NotReadyYet.selector, c.id, block.timestamp + 1)
        );
        script.executeChange(game, timelock, 200);

        vm.warp(block.timestamp + 1);
        script.executeChange(game, timelock, 200);
        assertTrue(timelock.isOperationDone(c.id));
        p = script.liveParams(game);
        assertEq(p.feeBps, 200);
        p.feeBps = before.feeBps;
        assertEq(abi.encode(p), abi.encode(before));

        // The open draw keeps charging $1.10; the next one charges $1.02.
        (uint256 price, uint256 fee) = game.quote(1, 1);
        assertEq(price + fee, 1_100_000);
        vm.warp(game.getDraw(1).cutoff);
        game.closeDraw(1);
        (price, fee) = game.quote(2, 1);
        assertEq(price + fee, 1_020_000);
        (price, fee) = game.quote(2, 10);
        assertEq(price + fee, 10_200_000);
    }

    function test_RevertWhen_TheFeeIsAlreadyLive() public {
        vm.expectRevert(abi.encodeWithSelector(SetFee.FeeAlreadySet.selector, 1_000));
        script.scheduleChange(game, timelock, 1_000);
        vm.expectRevert(abi.encodeWithSelector(SetFee.FeeAlreadySet.selector, 1_000));
        script.executeChange(game, timelock, 1_000);
    }

    function test_RevertWhen_ScheduledTwice() public {
        SetFee.Change memory c = script.scheduleChange(game, timelock, 200);
        vm.expectRevert(
            abi.encodeWithSelector(SetFee.AlreadyScheduled.selector, c.id, block.timestamp + DELAY)
        );
        script.scheduleChange(game, timelock, 200);
    }

    function test_RevertWhen_ExecutingWithoutSchedule() public {
        vm.expectRevert(abi.encodeWithSelector(SetFee.NotScheduled.selector, 200));
        script.executeChange(game, timelock, 200);
    }

    function test_SameChangeCanBeMadeAgain() public {
        _change(200);
        _change(1_000);
        SetFee.Change memory c = _change(200); // same call as the first: needs a new salt
        assertEq(c.salt, bytes32(uint256(1)));
        assertEq(script.liveParams(game).feeBps, 200);
    }

    function _change(uint16 fee) internal returns (SetFee.Change memory c) {
        c = script.scheduleChange(game, timelock, fee);
        vm.warp(block.timestamp + DELAY);
        script.executeChange(game, timelock, fee);
    }
}
