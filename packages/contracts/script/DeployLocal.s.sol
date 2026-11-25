// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DailyDraw} from "../src/DailyDraw.sol";
import {DevRandomness} from "../src/dev/DevRandomness.sol";
import {DevUSDC} from "../src/dev/DevUSDC.sol";
import {DeployDailyDraw} from "./DeployDailyDraw.s.sol";

/// Local / testnet demo deployment: DevUSDC (public faucet), DevRandomness (the operator triggers
/// the answer by hand) and DailyDraw behind its proxy, with the production roles given to the
/// deployer. Writes the addresses to `deployments/<chainId>.json`.
///
/// Run through `pnpm dev:chain`, which also writes `apps/web/.env.local`. Directly:
///   forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast \
///     --private-key <anvil key 0>
/// Env (all optional): FIRST_CUTOFF (unix; default the next 8:45pm WAT), SEED_WALLETS
/// (comma-separated addresses that get $1,000 test USDC; default Anvil accounts 1 to 5).
/// Never use this on a mainnet: DevRandomness is not random.
contract DeployLocal is DeployDailyDraw {
    /// 8:45pm WAT = 19:45 UTC, in seconds after midnight UTC.
    uint256 internal constant CUTOFF_UTC = 19 hours + 45 minutes;
    uint256 internal constant SEED_AMOUNT = 1_000e6;

    function run() external override returns (DailyDraw game, TimelockController timelock) {
        uint64 firstCutoff = uint64(vm.envOr("FIRST_CUTOFF", nextCutoff(block.timestamp)));
        address[] memory seeds = vm.envOr("SEED_WALLETS", ",", defaultSeeds());
        uint256 startBlock = block.number;

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        DevUSDC usdc = new DevUSDC();
        DevRandomness rng = new DevRandomness(deployer);
        (game, timelock) = deploy(
            Config({
                multisig: deployer,
                usdc: usdc,
                randomness: rng,
                treasury: deployer,
                buybackReserve: deployer,
                params: defaultParams(),
                firstCutoff: firstCutoff
            })
        );
        for (uint256 i; i < seeds.length; ++i) {
            usdc.mint(seeds[i], SEED_AMOUNT);
        }
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", startBlock);
        vm.serializeAddress(key, "usdc", address(usdc));
        vm.serializeAddress(key, "randomness", address(rng));
        vm.serializeAddress(key, "timelock", address(timelock));
        vm.serializeAddress(key, "operator", deployer);
        string memory json = vm.serializeAddress(key, "dailyDraw", address(game));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }

    /// @notice The next 8:45pm WAT at least 10 minutes after `nowTs`.
    function nextCutoff(uint256 nowTs) public pure returns (uint256 cutoff) {
        cutoff = nowTs / 1 days * 1 days + CUTOFF_UTC;
        if (cutoff < nowTs + 10 minutes) cutoff += 1 days;
    }

    function defaultSeeds() internal pure returns (address[] memory seeds) {
        // Anvil's default accounts 1 to 5 (account 0 deploys and operates the draw).
        seeds = new address[](5);
        seeds[0] = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
        seeds[1] = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
        seeds[2] = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
        seeds[3] = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
        seeds[4] = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;
    }
}
