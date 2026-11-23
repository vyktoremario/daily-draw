// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {DrawAnchor} from "../src/DrawAnchor.sol";

/// Usage (local): forge script script/DeployDrawAnchor.s.sol --rpc-url http://localhost:8545 --broadcast
/// Set ANCHORER to the worker's address. Never use a production key on a test network or vice versa.
contract DeployDrawAnchor is Script {
    function run() external returns (DrawAnchor deployed) {
        address anchorer = vm.envAddress("ANCHORER");
        vm.startBroadcast();
        deployed = new DrawAnchor(anchorer);
        vm.stopBroadcast();
    }
}
