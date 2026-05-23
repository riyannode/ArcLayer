// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/AgentRegistryV2.sol";

contract DeployAgentRegistryV2 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        AgentRegistryV2 registry = new AgentRegistryV2();
        console.log("AgentRegistryV2 deployed at:", address(registry));

        vm.stopBroadcast();
    }
}
