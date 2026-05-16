// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/A2AAgentRegistry.sol";
import "../src/A2AReputationRegistry.sol";
import "../src/A2AReceiptRegistry.sol";
import "../src/MarketMirrorRegistry.sol";

/**
 * @notice Deploy ArcLayer A2A protocol contracts to Arc Testnet.
 *         Usage:
 *           export PRIVATE_KEY=0x...
 *           forge script script/DeployA2A.s.sol:DeployA2A \
 *             --rpc-url https://rpc.drpc.testnet.arc.network \
 *             --broadcast
 */
contract DeployA2A is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        A2AAgentRegistry agentReg = new A2AAgentRegistry();
        A2AReputationRegistry repReg = new A2AReputationRegistry();
        A2AReceiptRegistry receiptReg = new A2AReceiptRegistry();
        MarketMirrorRegistry mirrorReg = new MarketMirrorRegistry();

        vm.stopBroadcast();

        console.log("A2AAgentRegistry      :", address(agentReg));
        console.log("A2AReputationRegistry :", address(repReg));
        console.log("A2AReceiptRegistry    :", address(receiptReg));
        console.log("MarketMirrorRegistry  :", address(mirrorReg));
    }
}
