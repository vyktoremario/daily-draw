// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {DeployDailyDraw} from "../script/DeployDailyDraw.s.sol";
import {MockRandomness, MockUSDC} from "./mocks/Mocks.sol";

/// @notice A later version of the game, to prove upgrades go through the timelock.
contract DailyDrawV2 is DailyDraw {
    function version() external pure returns (uint256) {
        return 2;
    }
}

/// @notice Runs the deploy script's logic against mocks and checks who can change what (#27).
contract DeployTest is Test {
    DeployDailyDraw internal script;
    DailyDraw internal game;
    TimelockController internal timelock;
    MockUSDC internal usdc;
    MockRandomness internal rng;

    address internal multisig = makeAddr("safe");
    address internal treasury = makeAddr("treasury");
    address internal buyback = makeAddr("buyback");
    address internal alice = makeAddr("alice");

    uint256 internal constant DELAY = 48 hours;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        rng = new MockRandomness();
        script = new DeployDailyDraw();
        (game, timelock) = script.deploy(
            DeployDailyDraw.Config({
                multisig: multisig,
                usdc: usdc,
                randomness: rng,
                treasury: treasury,
                buybackReserve: buyback,
                params: script.defaultParams(),
                firstCutoff: uint64(block.timestamp + 12 hours)
            })
        );
    }

    function test_RolesAfterDeployment() public view {
        bytes32 adminRole = game.DEFAULT_ADMIN_ROLE();
        bytes32[4] memory roles =
            [adminRole, game.PAUSER_ROLE(), game.PARAMS_ROLE(), game.UPGRADER_ROLE()];

        assertTrue(game.hasRole(adminRole, multisig));
        assertTrue(game.hasRole(game.PAUSER_ROLE(), multisig));
        assertFalse(game.hasRole(game.PARAMS_ROLE(), multisig));
        assertFalse(game.hasRole(game.UPGRADER_ROLE(), multisig));
        assertTrue(game.hasRole(game.PARAMS_ROLE(), address(timelock)));
        assertTrue(game.hasRole(game.UPGRADER_ROLE(), address(timelock)));
        assertFalse(game.hasRole(adminRole, address(timelock)));

        // The deployer (the script contract here, the broadcaster on a real chain) has nothing.
        for (uint256 i; i < roles.length; ++i) {
            assertFalse(game.hasRole(roles[i], address(script)));
            assertFalse(game.hasRole(roles[i], address(this)));
            assertFalse(game.hasRole(roles[i], msg.sender));
        }

        assertEq(timelock.getMinDelay(), DELAY);
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), multisig));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), multisig));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), multisig));
        assertFalse(timelock.hasRole(timelock.EXECUTOR_ROLE(), address(0))); // not open to anyone
        assertTrue(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(timelock)));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(script)));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), multisig));

        assertEq(address(game.usdc()), address(usdc));
        assertEq(game.treasury(), treasury);
        assertEq(game.getDraw(1).params.unclaimedPrizeDays, 30);
    }

    function test_ParamsChangeOnlyThroughTheTimelockAfter48Hours() public {
        DailyDraw.Params memory p = script.defaultParams();
        p.ticketPrice = 2_000_000;
        bytes memory data = abi.encodeCall(DailyDraw.setParams, (p));
        bytes32 paramsRole = game.PARAMS_ROLE();

        // The multisig can't call it directly...
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, multisig, paramsRole
            )
        );
        vm.prank(multisig);
        game.setParams(p);

        // ...nor grant itself the role.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                multisig,
                game.UPGRADER_ROLE()
            )
        );
        vm.prank(multisig);
        game.grantRole(paramsRole, multisig);

        // ...nor schedule with less than 48 hours.
        vm.expectRevert(
            abi.encodeWithSelector(
                TimelockController.TimelockInsufficientDelay.selector, DELAY - 1, DELAY
            )
        );
        vm.prank(multisig);
        timelock.schedule(address(game), 0, data, bytes32(0), bytes32(0), DELAY - 1);

        // Only a proposer may schedule.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                timelock.PROPOSER_ROLE()
            )
        );
        vm.prank(alice);
        timelock.schedule(address(game), 0, data, bytes32(0), bytes32(0), DELAY);

        vm.prank(multisig);
        timelock.schedule(address(game), 0, data, bytes32(0), bytes32(0), DELAY);
        bytes32 id = timelock.hashOperation(address(game), 0, data, bytes32(0), bytes32(0));

        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                TimelockController.TimelockUnexpectedOperationState.selector,
                id,
                bytes32(1 << uint8(TimelockController.OperationState.Ready))
            )
        );
        vm.prank(multisig);
        timelock.execute(address(game), 0, data, bytes32(0), bytes32(0));

        vm.warp(block.timestamp + 1);
        // Only the multisig executes.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                timelock.EXECUTOR_ROLE()
            )
        );
        vm.prank(alice);
        timelock.execute(address(game), 0, data, bytes32(0), bytes32(0));

        vm.prank(multisig);
        timelock.execute(address(game), 0, data, bytes32(0), bytes32(0));
        (uint128 price,,,,,,,,,,) = game.params();
        assertEq(price, 2_000_000);
        assertEq(game.getDraw(1).params.ticketPrice, 1_000_000); // the open draw keeps its copy
    }

    function test_UpgradeOnlyThroughTheTimelockAfter48Hours() public {
        address v2 = address(new DailyDrawV2());
        bytes memory data = abi.encodeCall(game.upgradeToAndCall, (v2, ""));

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                multisig,
                game.UPGRADER_ROLE()
            )
        );
        vm.prank(multisig);
        game.upgradeToAndCall(v2, "");

        vm.prank(multisig);
        timelock.schedule(address(game), 0, data, bytes32(0), bytes32(0), DELAY);

        vm.warp(block.timestamp + DELAY - 1);
        vm.prank(multisig);
        vm.expectRevert();
        timelock.execute(address(game), 0, data, bytes32(0), bytes32(0));

        vm.warp(block.timestamp + 1);
        vm.prank(multisig);
        timelock.execute(address(game), 0, data, bytes32(0), bytes32(0));
        assertEq(DailyDrawV2(address(game)).version(), 2);
        // State survives the upgrade.
        assertEq(game.currentDrawId(), 1);
        assertTrue(game.hasRole(game.PAUSER_ROLE(), multisig));
    }

    function test_MultisigCancelsAScheduledChange() public {
        bytes memory data = abi.encodeCall(game.upgradeToAndCall, (address(new DailyDrawV2()), ""));
        vm.prank(multisig);
        timelock.schedule(address(game), 0, data, bytes32(0), bytes32(0), DELAY);
        bytes32 id = timelock.hashOperation(address(game), 0, data, bytes32(0), bytes32(0));

        vm.prank(multisig);
        timelock.cancel(id);
        vm.warp(block.timestamp + DELAY);
        vm.prank(multisig);
        vm.expectRevert();
        timelock.execute(address(game), 0, data, bytes32(0), bytes32(0));
    }

    function test_MultisigPausesWithoutTheTimelock() public {
        vm.prank(multisig);
        game.pause();
        assertTrue(game.paused());
    }
}
