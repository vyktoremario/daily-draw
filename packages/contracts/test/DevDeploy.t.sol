// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {DevRandomness} from "../src/dev/DevRandomness.sol";
import {DevUSDC} from "../src/dev/DevUSDC.sol";
import {DeployDailyDraw} from "../script/DeployDailyDraw.s.sol";
import {DeployLocal} from "../script/DeployLocal.s.sol";

/// @notice The local demo setup (`pnpm dev:chain`): faucet, hand-triggered randomness, a full loop.
contract DevDeployTest is Test {
    DeployLocal internal script;
    DevUSDC internal usdc;
    DevRandomness internal rng;
    DailyDraw internal game;

    address internal operator = makeAddr("operator");
    address internal alice = makeAddr("alice");

    function setUp() public {
        vm.warp(1_800_000_000);
        script = new DeployLocal();
        usdc = new DevUSDC();
        rng = new DevRandomness(operator);
        (game,) = script.deploy(
            DeployDailyDraw.Config({
                multisig: operator,
                usdc: usdc,
                randomness: rng,
                treasury: operator,
                buybackReserve: operator,
                params: script.defaultParams(),
                firstCutoff: uint64(script.nextCutoff(block.timestamp))
            })
        );
    }

    function test_NextCutoffIs1945Utc() public view {
        // Noon UTC -> 19:45 UTC the same day.
        uint256 t = block.timestamp; // a variable: literal maths would skip the rounding down
        uint256 noon = t / 1 days * 1 days + 12 hours;
        assertEq(script.nextCutoff(noon), noon - 12 hours + 19 hours + 45 minutes);
        // 19:40 UTC is under 10 minutes away -> tomorrow.
        uint256 late = noon + 7 hours + 40 minutes;
        assertEq(script.nextCutoff(late), noon - 12 hours + 1 days + 19 hours + 45 minutes);
    }

    function test_Faucet() public {
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.decimals(), 6);
        vm.expectRevert(abi.encodeWithSelector(DevUSDC.MintTooLarge.selector, 10_001e6, 10_000e6));
        usdc.mint(alice, 10_001e6);
    }

    function test_FullLoopWithHandTriggeredDraw() public {
        vm.startPrank(alice);
        usdc.faucet();
        usdc.approve(address(game), type(uint256).max);
        uint16[] memory numbers = new uint16[](1);
        numbers[0] = 42;
        game.buyTickets(1, numbers, address(0));
        vm.stopPrank();

        vm.warp(game.getDraw(1).cutoff);
        game.closeDraw(1);
        uint256 requestId = rng.lastRequestId();

        vm.expectRevert(DevRandomness.NotOperator.selector);
        rng.fulfill(requestId, 42);
        vm.expectRevert(abi.encodeWithSelector(DevRandomness.UnknownRequest.selector, 99));
        vm.prank(operator);
        rng.fulfill(99, 42);

        vm.prank(operator);
        rng.fulfill(requestId, 142); // 142 % 100 = 42
        assertEq(game.getDraw(1).winningNumber, 42);

        vm.expectRevert(abi.encodeWithSelector(DevRandomness.AlreadyFulfilled.selector, requestId));
        vm.prank(operator);
        rng.fulfill(requestId, 1);

        (uint256 tickets, uint256 prize) = game.claimable(1, alice);
        assertEq(tickets, 1);
        assertEq(prize, 650_000); // 65% of a $1 pool
    }
}
