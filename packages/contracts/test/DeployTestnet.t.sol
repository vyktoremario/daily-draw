// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {ChainlinkVrfProvider} from "../src/randomness/ChainlinkVrfProvider.sol";
import {DeployTestnet} from "../script/DeployTestnet.s.sol";
import {MockVrfCoordinator} from "./mocks/MockVrfCoordinator.sol";

/// @notice The Base Sepolia deployment's logic, against a mock VRF coordinator (#29).
contract DeployTestnetTest is Test {
    DeployTestnet internal script;
    MockVrfCoordinator internal coordinator;
    DeployTestnet.Deployment internal d;

    // The team's testnet wallets (public addresses, testnet only).
    address internal admin = 0xECfeb88A1fFcce1d7dec2Dbc9Ef53dc4301D109f;
    address internal keeper = 0x9032f538d36fD201D019d11361FDBb1EE72D1034;
    address internal alice = makeAddr("alice");
    address internal seed1 = makeAddr("seed1");
    address internal seed2 = makeAddr("seed2");

    uint256 internal constant SUB_ID = 42;
    bytes32 internal constant KEY_HASH = keccak256("lane");

    function setUp() public {
        vm.warp(1_800_000_000);
        script = new DeployTestnet();
        coordinator = new MockVrfCoordinator();
        address[] memory seeds = new address[](2);
        seeds[0] = seed1;
        seeds[1] = seed2;
        d = script.deployTestnet(
            DeployTestnet.TestnetConfig({
                admin: admin,
                keeper: keeper,
                treasury: admin,
                buybackReserve: admin,
                vrfCoordinator: coordinator,
                vrf: ChainlinkVrfProvider.VrfConfig({
                    keyHash: KEY_HASH,
                    subscriptionId: SUB_ID,
                    requestConfirmations: 3,
                    callbackGasLimit: 500_000,
                    nativePayment: false
                }),
                timelockDelay: 1 hours,
                firstCutoff: uint64(script.nextCutoff(block.timestamp)),
                seedWallets: seeds
            }),
            address(script)
        );
        coordinator.addConsumer(SUB_ID, address(d.randomness));
    }

    function test_RolesEndWithAdminAndKeeper() public view {
        DailyDraw game = d.game;
        address deployer = address(script);
        bytes32[5] memory roles = [
            game.DEFAULT_ADMIN_ROLE(),
            game.PAUSER_ROLE(),
            game.PARAMS_ROLE(),
            game.UPGRADER_ROLE(),
            game.KEEPER_ROLE()
        ];

        assertTrue(game.hasRole(game.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(game.hasRole(game.PAUSER_ROLE(), admin));
        assertTrue(game.hasRole(game.KEEPER_ROLE(), keeper));
        assertFalse(game.hasRole(game.DEFAULT_ADMIN_ROLE(), keeper));
        assertTrue(game.hasRole(game.PARAMS_ROLE(), address(d.timelock)));
        assertTrue(game.hasRole(game.UPGRADER_ROLE(), address(d.timelock)));
        for (uint256 i; i < roles.length; ++i) {
            assertFalse(game.hasRole(roles[i], deployer));
        }

        TimelockController t = d.timelock;
        assertEq(t.getMinDelay(), 1 hours);
        assertTrue(t.hasRole(t.PROPOSER_ROLE(), admin));
        assertTrue(t.hasRole(t.EXECUTOR_ROLE(), admin));
        assertTrue(t.hasRole(t.CANCELLER_ROLE(), admin));
        assertFalse(t.hasRole(t.PROPOSER_ROLE(), deployer));
        assertFalse(t.hasRole(t.DEFAULT_ADMIN_ROLE(), deployer));

        assertEq(d.randomness.owner(), admin);
        assertEq(d.randomness.consumer(), address(game));
        assertEq(address(d.randomness.coordinator()), address(coordinator));
        assertEq(address(game.randomness()), address(d.randomness));
        assertEq(address(game.usdc()), address(d.usdc));
        assertEq(game.treasury(), admin);
        assertEq(game.buybackReserve(), admin);
        assertEq(d.usdc.balanceOf(seed1), 1_000e6);
        assertEq(d.usdc.balanceOf(seed2), 1_000e6);
    }

    function test_FirstCutoffIsTheNext845pmWat() public view {
        uint64 cutoff = d.game.getDraw(1).cutoff;
        assertEq(cutoff % 1 days, 19 hours + 45 minutes);
        assertGt(cutoff, block.timestamp + 10 minutes - 1);
        assertLe(cutoff, block.timestamp + 1 days + 10 minutes);
    }

    function test_KeeperClosesAndClaimsForAWinner() public {
        DailyDraw game = d.game;
        vm.startPrank(alice);
        d.usdc.faucet();
        d.usdc.approve(address(game), type(uint256).max);
        uint16[] memory numbers = new uint16[](1);
        numbers[0] = 7;
        game.buyTickets(1, numbers, address(0));
        vm.stopPrank();

        vm.warp(game.getDraw(1).cutoff);
        vm.prank(keeper);
        game.closeDraw(1);
        coordinator.fulfill(coordinator.lastRequestId(), 7);

        vm.expectRevert();
        vm.prank(keeper);
        game.claimFor(alice, 1); // too early

        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, game.KEEPER_ROLE()
            )
        );
        vm.prank(alice);
        game.claimFor(alice, 1);

        uint256 before = d.usdc.balanceOf(alice);
        vm.prank(keeper);
        game.claimFor(alice, 1);
        assertEq(d.usdc.balanceOf(alice) - before, 650_000);
    }

    function test_ParamsChangeAfterTheShortTestnetDelay() public {
        DailyDraw game = d.game;
        DailyDraw.Params memory p = script.defaultParams();
        p.ticketPrice = 2_000_000;
        bytes memory data = abi.encodeCall(DailyDraw.setParams, (p));
        vm.prank(admin);
        d.timelock.schedule(address(game), 0, data, bytes32(0), bytes32(0), 1 hours);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(admin);
        d.timelock.execute(address(game), 0, data, bytes32(0), bytes32(0));
        (uint128 price,,,,,,,,,,) = game.params();
        assertEq(price, 2_000_000);
    }

    function test_VrfDefaultsForBaseSepolia() public view {
        (address c, bytes32 k) = script.vrfDefaults(84_532);
        assertEq(c, 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE);
        assertEq(k, 0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71);
        (c, k) = script.vrfDefaults(1);
        assertEq(c, address(0));
        assertEq(k, bytes32(0));
    }
}
