// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {IRandomnessProvider} from "../src/interfaces/IRandomnessProvider.sol";

/// Deploys DailyDraw (implementation + ERC-1967 proxy) and its 48-hour TimelockController.
///
/// Roles at the end (the deployer holds none, at any point):
/// - multisig (2-of-3 Safe): DailyDraw `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE`; on the timelock,
///   proposer, canceller and executor.
/// - timelock: DailyDraw `PARAMS_ROLE` and `UPGRADER_ROLE` (which also administers both roles).
///   The timelock administers itself, so changing its delay or proposers also takes 48 hours.
///
/// Usage:
///   MULTISIG=0x.. USDC=0x.. RANDOMNESS=0x.. TREASURY=0x.. BUYBACK_RESERVE=0x.. FIRST_CUTOFF=<unix> \
///   forge script script/DeployDailyDraw.s.sol --rpc-url <rpc> --broadcast
/// FIRST_CUTOFF is the first 8:45pm WAT (19:45 UTC) cutoff. Never use a production key on a test
/// network or vice versa.
contract DeployDailyDraw is Script {
    uint256 public constant TIMELOCK_DELAY = 48 hours;

    struct Config {
        address multisig;
        IERC20 usdc;
        IRandomnessProvider randomness;
        address treasury;
        address buybackReserve;
        DailyDraw.Params params;
        uint64 firstCutoff;
    }

    function run() external virtual returns (DailyDraw game, TimelockController timelock) {
        Config memory c = Config({
            multisig: vm.envAddress("MULTISIG"),
            usdc: IERC20(vm.envAddress("USDC")),
            randomness: IRandomnessProvider(vm.envAddress("RANDOMNESS")),
            treasury: vm.envAddress("TREASURY"),
            buybackReserve: vm.envAddress("BUYBACK_RESERVE"),
            params: defaultParams(),
            firstCutoff: uint64(vm.envUint("FIRST_CUTOFF"))
        });
        vm.startBroadcast();
        (game, timelock) = deploy(c);
        vm.stopBroadcast();
    }

    /// @dev The whole deployment, separate from `run` so tests can call it against mocks.
    function deploy(Config memory c) public returns (DailyDraw game, TimelockController timelock) {
        address[] memory multisig = new address[](1);
        multisig[0] = c.multisig;
        // Proposers also become cancellers. admin = 0: the timelock administers itself.
        timelock = new TimelockController(TIMELOCK_DELAY, multisig, multisig, address(0));

        DailyDraw impl = new DailyDraw();
        bytes memory init = abi.encodeCall(
            DailyDraw.initialize,
            (
                c.multisig,
                address(timelock),
                c.usdc,
                c.randomness,
                c.treasury,
                c.buybackReserve,
                c.params,
                c.firstCutoff
            )
        );
        game = DailyDraw(address(new ERC1967Proxy(address(impl), init)));
    }

    /// @notice Product rules (Design v0.2): $1 + 10% fee, 00-99, 65/10/5/20, 20 tickets per wallet,
    ///         one draw a day, referrers active within 30 days, 30 days to claim.
    function defaultParams() public pure returns (DailyDraw.Params memory) {
        return DailyDraw.Params({
            ticketPrice: 1_000_000,
            feeBps: 1_000,
            numberRange: 100,
            winnersBps: 6_500,
            teamBps: 1_000,
            buybackBps: 500,
            referrersBps: 2_000,
            maxTicketsPerWallet: 20,
            drawInterval: 1 days,
            referrerActiveDays: 30,
            unclaimedPrizeDays: 30
        });
    }
}
