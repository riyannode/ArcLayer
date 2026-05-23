// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/AgentRegistry.sol";
import "../src/JobEscrow.sol";
import "../src/ReputationOracle.sol";
import "../src/WorkProof.sol";

contract DeployArcLayer is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC");

        vm.startBroadcast(deployerPrivateKey);

        AgentRegistry agentRegistry = new AgentRegistry();
        console.log("AgentRegistry deployed at:", address(agentRegistry));

        WorkProof workProof = new WorkProof();
        console.log("WorkProof deployed at:", address(workProof));

        JobEscrow jobEscrow = new JobEscrow(usdc, address(agentRegistry), address(workProof));
        console.log("JobEscrow deployed at:", address(jobEscrow));

        ReputationOracle reputationOracle = new ReputationOracle(
            address(agentRegistry),
            address(workProof)
        );
        console.log("ReputationOracle deployed at:", address(reputationOracle));

        workProof.setMinter(address(jobEscrow));
        vm.stopBroadcast();
    }
}
