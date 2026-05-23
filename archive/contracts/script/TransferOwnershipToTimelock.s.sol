// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IOwnable {
    function transferOwnership(address newOwner) external;
    function owner() external view returns (address);
}

/**
 * @title TransferOwnershipToTimelock
 * @notice Transfer ownership of all core ArcLayer contracts to TimelockController.
 *
 * MUST be run with the CURRENT OWNER's private key (currently 0x9dc3...B074).
 * After this runs, only the timelock can call onlyOwner functions, gated by 24h delay.
 *
 * Usage:
 *   TIMELOCK=0x... \
 *   forge script script/TransferOwnershipToTimelock.s.sol \
 *     --rpc-url https://rpc.testnet.arc.network \
 *     --broadcast --private-key $OWNER_PK
 */
contract TransferOwnershipToTimelock is Script {
    // Live core contract addresses (Arc Testnet 5042002)
    address constant JOB_ESCROW = 0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225;
    address constant AGENT_REGISTRY = 0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21;
    address constant WORK_PROOF = 0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5;

    function run() external {
        address timelock = vm.envAddress("TIMELOCK");
        require(timelock != address(0), "TIMELOCK env required");

        // Pre-flight: verify all owners match (caller is current owner)
        address jeOwner = IOwnable(JOB_ESCROW).owner();
        address arOwner = IOwnable(AGENT_REGISTRY).owner();
        address wpOwner = IOwnable(WORK_PROOF).owner();

        console.log("=== Pre-transfer ownership ===");
        console.log("JobEscrow.owner:    ", jeOwner);
        console.log("AgentRegistry.owner:", arOwner);
        console.log("WorkProof.owner:    ", wpOwner);
        console.log("Target timelock:    ", timelock);
        require(jeOwner == arOwner && arOwner == wpOwner, "Owner mismatch - verify state");

        vm.startBroadcast();

        IOwnable(JOB_ESCROW).transferOwnership(timelock);
        IOwnable(AGENT_REGISTRY).transferOwnership(timelock);
        IOwnable(WORK_PROOF).transferOwnership(timelock);

        vm.stopBroadcast();

        console.log("=== Post-transfer ownership ===");
        console.log("JobEscrow.owner:    ", IOwnable(JOB_ESCROW).owner());
        console.log("AgentRegistry.owner:", IOwnable(AGENT_REGISTRY).owner());
        console.log("WorkProof.owner:    ", IOwnable(WORK_PROOF).owner());
    }
}
