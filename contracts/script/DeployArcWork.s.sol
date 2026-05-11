// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/Achievement.sol";
import "../src/MilestoneEscrow.sol";

contract DeployArcWork is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC");
        
        vm.startBroadcast(deployerPrivateKey);
        
        Achievement achievement = new Achievement();
        console.log("Achievement deployed at:", address(achievement));

        MilestoneEscrow milestoneEscrow = new MilestoneEscrow(usdc);
        console.log("MilestoneEscrow deployed at:", address(milestoneEscrow));
        
        vm.stopBroadcast();
    }
}
