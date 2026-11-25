// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {DevUSDC} from "../src/dev/DevUSDC.sol";
import {ChainlinkVrfProvider} from "../src/randomness/ChainlinkVrfProvider.sol";
import {VRFV2PlusClient} from "../src/vendor/chainlink/VRFV2PlusClient.sol";
import {DeployTestnet} from "../script/DeployTestnet.s.sol";
import {MockVrfCoordinator} from "./mocks/MockVrfCoordinator.sol";

/// @notice The Chainlink VRF v2.5 adapter, against a mock coordinator, wired to a real DailyDraw.
contract ChainlinkVrfProviderTest is Test {
    DeployTestnet internal script;
    MockVrfCoordinator internal coordinator;
    ChainlinkVrfProvider internal vrf;
    DailyDraw internal game;
    DevUSDC internal usdc;

    address internal admin = makeAddr("admin");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant SUB_ID =
        55_154_512_345_678_901_234_567_890_123_456_789_012_345_678_901_234_567_890_123_456_782_655;
    bytes32 internal constant KEY_HASH =
        0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;

    function setUp() public {
        vm.warp(1_800_000_000);
        script = new DeployTestnet();
        coordinator = new MockVrfCoordinator();
        DeployTestnet.Deployment memory d = script.deployTestnet(config(), address(script));
        vrf = d.randomness;
        game = d.game;
        usdc = d.usdc;
        // What the runbook has the user do at vrf.chain.link.
        coordinator.addConsumer(SUB_ID, address(vrf));
    }

    function config() internal view returns (DeployTestnet.TestnetConfig memory) {
        return DeployTestnet.TestnetConfig({
            admin: admin,
            keeper: keeper,
            treasury: admin,
            buybackReserve: admin,
            vrfCoordinator: coordinator,
            vrf: ChainlinkVrfProvider.VrfConfig({
                keyHash: KEY_HASH,
                subscriptionId: SUB_ID,
                requestConfirmations: 3,
                callbackGasLimit: script.DEFAULT_CALLBACK_GAS_LIMIT(),
                nativePayment: false
            }),
            timelockDelay: 1 hours,
            firstCutoff: uint64(script.nextCutoff(block.timestamp)),
            seedWallets: new address[](0)
        });
    }

    function buy(address player, uint16[] memory numbers) internal {
        vm.startPrank(player);
        usdc.mint(player, 100e6);
        usdc.approve(address(game), type(uint256).max);
        game.buyTickets(game.currentDrawId(), numbers, address(0));
        vm.stopPrank();
    }

    function one(uint16 n) internal pure returns (uint16[] memory a) {
        a = new uint16[](1);
        a[0] = n;
    }

    function closeCurrent() internal returns (uint256 drawId, uint256 requestId) {
        drawId = game.currentDrawId();
        vm.warp(game.getDraw(drawId).cutoff);
        vm.prank(keeper);
        game.closeDraw(drawId);
        requestId = game.getDraw(drawId).requestId;
    }

    // ---------------------------------------------------------------------------------------------

    function test_ExtraArgsTagMatchesChainlink() public pure {
        assertEq(VRFV2PlusClient.EXTRA_ARGS_V1_TAG, bytes4(0x92fd1338));
    }

    function test_RequestCarriesTheSubscriptionSettings() public {
        (, uint256 requestId) = closeCurrent();
        assertEq(requestId, coordinator.lastRequestId());
        assertTrue(vrf.pending(requestId));

        MockVrfCoordinator.Request memory r = coordinator.request(requestId);
        assertEq(r.consumer, address(vrf));
        assertEq(r.keyHash, KEY_HASH);
        assertEq(r.subId, SUB_ID);
        assertEq(r.requestConfirmations, 3);
        assertEq(r.callbackGasLimit, 500_000);
        assertEq(r.numWords, 1);
        assertEq(r.extraArgs, abi.encodeWithSelector(bytes4(0x92fd1338), false));
    }

    function test_FullDrawThroughVrf() public {
        buy(alice, one(42));
        buy(bob, one(7));
        (uint256 drawId, uint256 requestId) = closeCurrent();

        vm.expectEmit(address(vrf));
        emit ChainlinkVrfProvider.RandomnessFulfilled(requestId, 1042);
        (bool ok,) = coordinator.fulfill(requestId, 1042); // 1042 % 100 = 42
        assertTrue(ok);
        assertFalse(vrf.pending(requestId));

        DailyDraw.Draw memory d = game.getDraw(drawId);
        assertEq(uint8(d.status), uint8(DailyDraw.Status.Settled));
        assertEq(d.winningNumber, 42);
        (uint256 tickets, uint256 prize) = game.claimable(drawId, alice);
        assertEq(tickets, 1);
        assertEq(prize, 1_300_000); // 65% of a $2 pool
    }

    function test_OnlyTheGameCanRequest() public {
        vm.expectRevert(abi.encodeWithSelector(ChainlinkVrfProvider.OnlyConsumer.selector, alice));
        vm.prank(alice);
        vrf.requestRandomness();
    }

    function test_OnlyTheCoordinatorCanFulfil() public {
        (, uint256 requestId) = closeCurrent();
        uint256[] memory words = new uint256[](1);
        words[0] = 42;
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkVrfProvider.OnlyCoordinatorCanFulfill.selector, alice, address(coordinator)
            )
        );
        vm.prank(alice);
        vrf.rawFulfillRandomWords(requestId, words);
    }

    function test_UnknownOrRepeatedFulfilmentReverts() public {
        (, uint256 requestId) = closeCurrent();
        uint256[] memory words = new uint256[](1);
        words[0] = 42;

        vm.expectRevert(abi.encodeWithSelector(ChainlinkVrfProvider.UnknownRequest.selector, 123));
        vm.prank(address(coordinator));
        vrf.rawFulfillRandomWords(123, words);

        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkVrfProvider.NoRandomWords.selector, requestId)
        );
        vm.prank(address(coordinator));
        vrf.rawFulfillRandomWords(requestId, new uint256[](0));

        vm.prank(address(coordinator));
        vrf.rawFulfillRandomWords(requestId, words);

        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkVrfProvider.UnknownRequest.selector, requestId)
        );
        vm.prank(address(coordinator));
        vrf.rawFulfillRandomWords(requestId, words);
    }

    function test_CoordinatorRejectsAnAdapterThatIsNotAConsumer() public {
        MockVrfCoordinator other = new MockVrfCoordinator();
        DeployTestnet.TestnetConfig memory c = config();
        c.vrfCoordinator = other;
        DeployTestnet.Deployment memory d = script.deployTestnet(c, address(script));
        vm.warp(d.game.getDraw(1).cutoff);
        // Forgot to add the adapter at vrf.chain.link: closing fails, and the draw stays open.
        vm.expectRevert(
            abi.encodeWithSelector(
                MockVrfCoordinator.InvalidConsumer.selector, SUB_ID, address(d.randomness)
            )
        );
        d.game.closeDraw(1);
        assertEq(uint8(d.game.getDraw(1).status), uint8(DailyDraw.Status.Open));
    }

    /// The worst case for the callback: a winning draw settling a rollover, with every storage slot
    /// cold as on a real chain. The configured gas limit must leave at least 2x headroom.
    function test_SettlementFitsTheCallbackGasLimit() public {
        // Draw 1: nobody wins, so its pool rolls over.
        buy(alice, one(1));
        (, uint256 r1) = closeCurrent();
        coordinator.fulfill(r1, 50);
        assertGt(game.rollover(), 0);

        // Draw 2: winners, losers and the rollover.
        vm.startPrank(alice);
        game.buyTickets(game.currentDrawId(), one(42), bob);
        vm.stopPrank();
        uint16[] memory ten = new uint16[](10);
        for (uint16 i; i < 10; ++i) {
            ten[i] = 40 + i;
        }
        buy(bob, ten);
        (uint256 drawId, uint256 r2) = closeCurrent();

        vm.cool(address(game));
        vm.cool(address(vrf));
        vm.cool(address(usdc));
        (bool ok, uint256 gasUsed) = coordinator.fulfill(r2, 42);
        assertTrue(ok);
        assertEq(uint8(game.getDraw(drawId).status), uint8(DailyDraw.Status.Settled));
        emit log_named_uint("callback gas used", gasUsed);
        assertLt(gasUsed * 2, script.DEFAULT_CALLBACK_GAS_LIMIT());
    }

    function test_FailedCallbackLeavesTheDrawVoidable() public {
        buy(alice, one(42));
        vm.prank(admin);
        vrf.setConfig(
            ChainlinkVrfProvider.VrfConfig({
                keyHash: KEY_HASH,
                subscriptionId: SUB_ID,
                requestConfirmations: 3,
                callbackGasLimit: 30_000, // too little
                nativePayment: false
            })
        );
        (uint256 drawId, uint256 requestId) = closeCurrent();
        (bool ok,) = coordinator.fulfill(requestId, 42);
        assertFalse(ok); // the coordinator doesn't revert or retry
        assertEq(uint8(game.getDraw(drawId).status), uint8(DailyDraw.Status.Closed));

        vm.prank(admin);
        game.voidDraw(drawId, "VRF callback ran out of gas");
        vm.prank(alice);
        game.refund(drawId, one(42));
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    function test_OwnerSettings() public {
        assertEq(vrf.owner(), admin);
        assertEq(vrf.consumer(), address(game));

        // The consumer is set once.
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkVrfProvider.ConsumerAlreadySet.selector, address(game))
        );
        vm.prank(admin);
        vrf.setConsumer(alice);

        ChainlinkVrfProvider.VrfConfig memory c = ChainlinkVrfProvider.VrfConfig({
            keyHash: bytes32(uint256(1)),
            subscriptionId: 2,
            requestConfirmations: 10,
            callbackGasLimit: 800_000,
            nativePayment: true
        });
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        vrf.setConfig(c);

        vm.prank(admin);
        vrf.setConfig(c);
        (bytes32 keyHash, uint256 subId, uint16 confirmations, uint32 gasLimit, bool native) =
            vrf.config();
        assertEq(keyHash, bytes32(uint256(1)));
        assertEq(subId, 2);
        assertEq(confirmations, 10);
        assertEq(gasLimit, 800_000);
        assertTrue(native);

        c.subscriptionId = 0;
        vm.expectRevert(ChainlinkVrfProvider.InvalidConfig.selector);
        vm.prank(admin);
        vrf.setConfig(c);
    }

    function test_ConstructorAndConsumerChecks() public {
        ChainlinkVrfProvider.VrfConfig memory c = ChainlinkVrfProvider.VrfConfig({
            keyHash: KEY_HASH,
            subscriptionId: SUB_ID,
            requestConfirmations: 3,
            callbackGasLimit: 500_000,
            nativePayment: false
        });
        vm.expectRevert(ChainlinkVrfProvider.ZeroAddress.selector);
        new ChainlinkVrfProvider(MockVrfCoordinator(address(0)), c, admin);

        c.keyHash = bytes32(0);
        vm.expectRevert(ChainlinkVrfProvider.InvalidConfig.selector);
        new ChainlinkVrfProvider(coordinator, c, admin);

        c.keyHash = KEY_HASH;
        ChainlinkVrfProvider fresh = new ChainlinkVrfProvider(coordinator, c, admin);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        fresh.setConsumer(alice);
        vm.expectRevert(ChainlinkVrfProvider.ZeroAddress.selector);
        vm.prank(admin);
        fresh.setConsumer(address(0));
    }
}
