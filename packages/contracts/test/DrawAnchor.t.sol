// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DrawAnchor} from "../src/DrawAnchor.sol";

contract DrawAnchorTest is Test {
    DrawAnchor internal anchors;
    address internal worker = makeAddr("worker");

    bytes32 internal constant COMMITMENT = keccak256("commitment");
    bytes32 internal constant ROOT = keccak256("root");

    function setUp() public {
        anchors = new DrawAnchor(worker);
    }

    function test_AnchorsADraw() public {
        vm.warp(1_795_000_000);
        vm.prank(worker);
        anchors.anchor(313, COMMITMENT, ROOT, 13_401_822, 4_133, 41_330_000);

        DrawAnchor.Anchor memory a = anchors.getAnchor(313);
        assertEq(a.commitment, COMMITMENT);
        assertEq(a.merkleRoot, ROOT);
        assertEq(a.drandRound, 13_401_822);
        assertEq(a.ticketCount, 4_133);
        assertEq(a.salesKobo, 41_330_000);
        assertEq(a.anchoredAt, 1_795_000_000);
        assertTrue(anchors.isAnchored(313));
    }

    function test_EmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit DrawAnchor.DrawAnchored(313, COMMITMENT, ROOT, 1, 2, 3);
        vm.prank(worker);
        anchors.anchor(313, COMMITMENT, ROOT, 1, 2, 3);
    }

    function test_RevertWhen_NotAnchorer() public {
        vm.expectRevert(DrawAnchor.NotAnchorer.selector);
        anchors.anchor(313, COMMITMENT, ROOT, 1, 2, 3);
    }

    function test_RevertWhen_AnchoredTwice() public {
        vm.startPrank(worker);
        anchors.anchor(313, COMMITMENT, ROOT, 1, 2, 3);
        vm.expectRevert(abi.encodeWithSelector(DrawAnchor.AlreadyAnchored.selector, 313));
        anchors.anchor(313, keccak256("other"), ROOT, 1, 2, 3);
        vm.stopPrank();
    }

    function test_RevertWhen_EmptyCommitment() public {
        vm.prank(worker);
        vm.expectRevert(DrawAnchor.EmptyCommitment.selector);
        anchors.anchor(313, bytes32(0), ROOT, 1, 2, 3);
    }

    /// Anyone other than the anchorer can never write, whatever they send.
    function testFuzz_OnlyAnchorerCanWrite(address caller, uint256 drawNumber, bytes32 commitment)
        public
    {
        vm.assume(caller != worker);
        vm.prank(caller);
        vm.expectRevert(DrawAnchor.NotAnchorer.selector);
        anchors.anchor(drawNumber, commitment, ROOT, 1, 2, 3);
    }

    /// Once written, an anchor can never change.
    function testFuzz_AnchorIsPermanent(uint256 drawNumber, bytes32 second) public {
        vm.startPrank(worker);
        anchors.anchor(drawNumber, COMMITMENT, ROOT, 1, 2, 3);
        vm.expectRevert(abi.encodeWithSelector(DrawAnchor.AlreadyAnchored.selector, drawNumber));
        anchors.anchor(drawNumber, second == bytes32(0) ? COMMITMENT : second, ROOT, 9, 9, 9);
        vm.stopPrank();
        assertEq(anchors.getAnchor(drawNumber).commitment, COMMITMENT);
    }
}
