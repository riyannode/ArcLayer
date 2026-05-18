// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title DeployTimelock
 * @notice Deploy OZ TimelockController for ArcLayer protocol governance.
 *
 * Usage:
 *   OWNER=0x9dc3f8F2E2Aa59F9300D9B40D16725317F52B074 \
 *   forge script script/DeployTimelock.s.sol \
 *     --rpc-url https://rpc.testnet.arc.network \
 *     --broadcast --private-key $OWNER_PK
 *
 * Parameters (env):
 *   OWNER          - Current protocol owner EOA (proposer + executor initially)
 *   TIMELOCK_DELAY - Delay in seconds (default: 86400 = 24h)
 */
contract DeployTimelock is Script {
    function run() external {
        address owner = vm.envAddress("OWNER");
        uint256 delay = vm.envOr("TIMELOCK_DELAY", uint256(86400)); // 24h default

        // Proposers and executors = owner EOA initially
        // Later: replace with Safe multisig, then revoke EOA
        address[] memory proposers = new address[](1);
        proposers[0] = owner;

        address[] memory executors = new address[](1);
        executors[0] = owner;

        vm.startBroadcast();

        TimelockController timelock = new TimelockController(
            delay,
            proposers,
            executors,
            address(0) // no default admin — only proposers can schedule
        );

        vm.stopBroadcast();

        console.log("TimelockController deployed at:", address(timelock));
        console.log("Min delay:", delay, "seconds");
        console.log("Proposer/Executor:", owner);
    }
}
