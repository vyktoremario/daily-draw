// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {DevUSDC} from "../src/dev/DevUSDC.sol";
import {ChainlinkVrfProvider} from "../src/randomness/ChainlinkVrfProvider.sol";
import {IVRFCoordinatorV2Plus} from "../src/vendor/chainlink/IVRFCoordinatorV2Plus.sol";
import {DeployDailyDraw} from "./DeployDailyDraw.s.sol";

/// Public testnet deployment (Base Sepolia first; any chain with Chainlink VRF v2.5 works):
/// test USDC with a public faucet, the Chainlink VRF v2.5 adapter, the timelock and DailyDraw
/// behind its proxy. Writes the addresses to `deployments/<TESTNET_NETWORK>.json`, which the web
/// app and the keeper read.
///
/// Roles at the end (the deployer holds none):
/// - ADMIN_ADDRESS: DailyDraw `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE`; timelock proposer, canceller
///   and executor; owner of the VRF adapter.
/// - KEEPER_ADDRESS: DailyDraw `KEEPER_ROLE` (closes draws, claims for winners after 24 hours).
/// - timelock (TIMELOCK_DELAY, 1 hour by default here): `PARAMS_ROLE` and `UPGRADER_ROLE`.
///
/// Run it with `pnpm testnet:deploy` (scripts/deploy-testnet.sh), which reads the repo's `.env`;
/// see docs/testnet-runbook.md. Env:
///   DEPLOYER_PRIVATE_KEY, ADMIN_ADDRESS, KEEPER_ADDRESS, VRF_SUBSCRIPTION_ID   required
///   TESTNET_NETWORK (deployment file name; default "base-sepolia")
///   VRF_COORDINATOR, VRF_KEY_HASH (defaults for known chains, see `vrfDefaults`)
///   VRF_CALLBACK_GAS_LIMIT (500000), VRF_REQUEST_CONFIRMATIONS (3), VRF_NATIVE_PAYMENT (false)
///   TIMELOCK_DELAY (seconds; default 3600), FIRST_CUTOFF (unix; default the next 8:45pm WAT)
///   TREASURY_ADDRESS, BUYBACK_ADDRESS (default ADMIN_ADDRESS)
///   SEED_WALLETS (comma-separated; each gets $1,000 test USDC)
contract DeployTestnet is DeployDailyDraw {
    /// 8:45pm WAT = 19:45 UTC, in seconds after midnight UTC.
    uint256 internal constant CUTOFF_UTC = 19 hours + 45 minutes;
    uint256 internal constant SEED_AMOUNT = 1_000e6;
    uint256 public constant TESTNET_TIMELOCK_DELAY = 1 hours;
    /// Settlement through the adapter uses about 150k gas (test/ChainlinkVrfProvider.t.sol checks
    /// the worst case fits); the rest is headroom. Unused callback gas isn't charged.
    uint32 public constant DEFAULT_CALLBACK_GAS_LIMIT = 500_000;
    uint16 public constant DEFAULT_REQUEST_CONFIRMATIONS = 3;

    uint256 internal constant BASE_SEPOLIA = 84_532;

    struct TestnetConfig {
        address admin;
        address keeper;
        address treasury;
        address buybackReserve;
        IVRFCoordinatorV2Plus vrfCoordinator;
        ChainlinkVrfProvider.VrfConfig vrf;
        uint256 timelockDelay;
        uint64 firstCutoff;
        address[] seedWallets;
    }

    struct Deployment {
        DevUSDC usdc;
        ChainlinkVrfProvider randomness;
        TimelockController timelock;
        DailyDraw game;
    }

    error MainnetNotAllowed(uint256 chainId);
    error NoVrfDefaults(uint256 chainId);

    function run() external override returns (DailyDraw game, TimelockController timelock) {
        if (block.chainid == 1 || block.chainid == 8453 || block.chainid == 42_220) {
            revert MainnetNotAllowed(block.chainid); // test USDC anyone can mint
        }
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        TestnetConfig memory t = configFromEnv();
        uint256 startBlock = block.number;

        vm.startBroadcast(deployerKey);
        Deployment memory d = deployTestnet(t, deployer);
        vm.stopBroadcast();

        writeDeployment(t, d, startBlock);
        return (d.game, d.timelock);
    }

    function configFromEnv() internal view returns (TestnetConfig memory t) {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        (address defaultCoordinator, bytes32 defaultKeyHash) = vrfDefaults(block.chainid);
        address coordinator = vm.envOr("VRF_COORDINATOR", defaultCoordinator);
        bytes32 keyHash = vm.envOr("VRF_KEY_HASH", defaultKeyHash);
        if (coordinator == address(0) || keyHash == bytes32(0)) {
            revert NoVrfDefaults(block.chainid); // set VRF_COORDINATOR and VRF_KEY_HASH
        }
        t = TestnetConfig({
            admin: admin,
            keeper: vm.envAddress("KEEPER_ADDRESS"),
            treasury: vm.envOr("TREASURY_ADDRESS", admin),
            buybackReserve: vm.envOr("BUYBACK_ADDRESS", admin),
            vrfCoordinator: IVRFCoordinatorV2Plus(coordinator),
            vrf: ChainlinkVrfProvider.VrfConfig({
                keyHash: keyHash,
                subscriptionId: vm.envUint("VRF_SUBSCRIPTION_ID"),
                requestConfirmations: uint16(
                    vm.envOr("VRF_REQUEST_CONFIRMATIONS", uint256(DEFAULT_REQUEST_CONFIRMATIONS))
                ),
                callbackGasLimit: uint32(
                    vm.envOr("VRF_CALLBACK_GAS_LIMIT", uint256(DEFAULT_CALLBACK_GAS_LIMIT))
                ),
                nativePayment: vm.envOr("VRF_NATIVE_PAYMENT", false)
            }),
            timelockDelay: vm.envOr("TIMELOCK_DELAY", TESTNET_TIMELOCK_DELAY),
            firstCutoff: uint64(vm.envOr("FIRST_CUTOFF", nextCutoff(block.timestamp))),
            seedWallets: vm.envOr("SEED_WALLETS", ",", new address[](0))
        });
    }

    /// @notice Chainlink VRF v2.5 coordinator and 30 gwei key hash per chain, from
    ///         https://docs.chain.link/vrf/v2-5/supported-networks (read 2026-11-25).
    function vrfDefaults(uint256 chainId)
        public
        pure
        returns (address coordinator, bytes32 keyHash)
    {
        if (chainId == BASE_SEPOLIA) {
            return (
                0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE,
                0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71
            );
        }
    }

    /// @notice The whole deployment. `deployer` must be the account sending these calls (the
    ///         broadcaster on a real chain, the script contract in tests): it holds the admin roles
    ///         for a moment to grant the keeper role, then hands everything to `t.admin`.
    function deployTestnet(TestnetConfig memory t, address deployer)
        public
        returns (Deployment memory d)
    {
        d.usdc = new DevUSDC();
        d.randomness = new ChainlinkVrfProvider(t.vrfCoordinator, t.vrf, deployer);
        d.timelock = deployTimelock(t.admin, t.timelockDelay);
        d.game = deployGame(
            Config({
                multisig: t.admin,
                usdc: d.usdc,
                randomness: d.randomness,
                treasury: t.treasury,
                buybackReserve: t.buybackReserve,
                params: defaultParams(),
                firstCutoff: t.firstCutoff
            }),
            deployer,
            d.timelock
        );

        d.randomness.setConsumer(address(d.game));
        d.randomness.transferOwnership(t.admin);

        DailyDraw game = d.game;
        game.grantRole(game.KEEPER_ROLE(), t.keeper);
        game.grantRole(game.DEFAULT_ADMIN_ROLE(), t.admin);
        game.grantRole(game.PAUSER_ROLE(), t.admin);
        if (deployer != t.admin) {
            game.renounceRole(game.PAUSER_ROLE(), deployer);
            game.renounceRole(game.DEFAULT_ADMIN_ROLE(), deployer);
        }

        for (uint256 i; i < t.seedWallets.length; ++i) {
            d.usdc.mint(t.seedWallets[i], SEED_AMOUNT);
        }
    }

    /// @notice The next 8:45pm WAT at least 10 minutes after `nowTs`.
    function nextCutoff(uint256 nowTs) public pure returns (uint256 cutoff) {
        cutoff = nowTs / 1 days * 1 days + CUTOFF_UTC;
        if (cutoff < nowTs + 10 minutes) cutoff += 1 days;
    }

    function writeDeployment(TestnetConfig memory t, Deployment memory d, uint256 startBlock)
        internal
    {
        string memory network = vm.envOr(
            "TESTNET_NETWORK",
            block.chainid == BASE_SEPOLIA ? string("base-sepolia") : vm.toString(block.chainid)
        );
        address impl =
            address(uint160(uint256(vm.load(address(d.game), ERC1967Utils.IMPLEMENTATION_SLOT))));

        string memory key = "deployment";
        vm.serializeString(key, "network", network);
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", startBlock);
        vm.serializeUint(key, "deployedAt", block.timestamp);
        vm.serializeAddress(key, "dailyDraw", address(d.game));
        vm.serializeAddress(key, "dailyDrawImplementation", impl);
        vm.serializeAddress(key, "usdc", address(d.usdc));
        vm.serializeAddress(key, "randomness", address(d.randomness));
        vm.serializeAddress(key, "timelock", address(d.timelock));
        vm.serializeUint(key, "timelockDelay", t.timelockDelay);
        vm.serializeAddress(key, "admin", t.admin);
        vm.serializeAddress(key, "keeper", t.keeper);
        vm.serializeUint(key, "firstCutoff", t.firstCutoff);
        vm.serializeAddress(key, "vrfCoordinator", address(t.vrfCoordinator));
        vm.serializeBytes32(key, "vrfKeyHash", t.vrf.keyHash);
        // A string: subscription ids are larger than JavaScript numbers can hold exactly.
        string memory json =
            vm.serializeString(key, "vrfSubscriptionId", vm.toString(t.vrf.subscriptionId));
        vm.createDir("deployments", true);
        vm.writeJson(json, string.concat("deployments/", network, ".json"));
    }
}
