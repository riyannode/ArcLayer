// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgentRegistryV2.sol";

contract AgentRegistryV2Test is Test {
    AgentRegistryV2 reg;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address owner = address(this);

    bytes32 constant SKILL = keccak256("solidity-auditor");

    event AgentRegistered(uint256 indexed agentId, bytes32 indexed skillHash, address indexed controller, string metadataURI);
    event AgentDeregistered(uint256 indexed agentId, address indexed controller);
    event AgentReactivated(uint256 indexed agentId, address indexed controller);

    function setUp() public {
        reg = new AgentRegistryV2();
    }

    // ─── register ────────────────────────────────────────────────────────────────

    function test_register() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit AgentRegistered(1, SKILL, alice, "ipfs://x");
        reg.registerAgent(1, SKILL, "ipfs://x");

        AgentRegistryV2.AgentRecord memory a = reg.getAgent(1);
        assertEq(a.agentId, 1);
        assertEq(a.controller, alice);
        assertEq(uint256(a.status), uint256(AgentRegistryV2.AgentStatus.Active));
        assertTrue(a.exists);
        assertTrue(reg.isActive(1));
    }

    function test_register_revert_zeroId() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Invalid agent"));
        reg.registerAgent(0, SKILL, "ipfs://x");
    }

    function test_register_revert_duplicate() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");
        vm.prank(bob);
        vm.expectRevert(bytes("Agent exists"));
        reg.registerAgent(1, SKILL, "ipfs://y");
    }

    // ─── deregister ──────────────────────────────────────────────────────────────

    function test_deregister_byController() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit AgentDeregistered(1, alice);
        reg.deregisterAgent(1);

        assertFalse(reg.isActive(1));
        assertTrue(reg.exists(1));
        AgentRegistryV2.AgentRecord memory a = reg.getAgent(1);
        assertEq(uint256(a.status), uint256(AgentRegistryV2.AgentStatus.Deactivated));
    }

    function test_deregister_revert_notController() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");

        vm.prank(bob);
        vm.expectRevert(bytes("Not controller"));
        reg.deregisterAgent(1);
    }

    function test_deregister_revert_alreadyDeactivated() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");
        vm.prank(alice);
        reg.deregisterAgent(1);

        vm.prank(alice);
        vm.expectRevert(bytes("Already deactivated"));
        reg.deregisterAgent(1);
    }

    function test_deregister_revert_missing() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Agent missing"));
        reg.deregisterAgent(999);
    }

    // ─── reactivate ──────────────────────────────────────────────────────────────

    function test_reactivate() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");
        vm.prank(alice);
        reg.deregisterAgent(1);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit AgentReactivated(1, alice);
        reg.reactivateAgent(1);

        assertTrue(reg.isActive(1));
    }

    function test_reactivate_revert_notDeactivated() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");

        vm.prank(alice);
        vm.expectRevert(bytes("Already active"));
        reg.reactivateAgent(1);
    }

    // ─── getActiveAgent ──────────────────────────────────────────────────────────

    function test_getActiveAgent_revert_inactive() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");
        vm.prank(alice);
        reg.deregisterAgent(1);

        vm.expectRevert(bytes("Agent inactive"));
        reg.getActiveAgent(1);
    }

    // ─── pruneInactive ───────────────────────────────────────────────────────────

    function test_pruneInactive_ownerOnly() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");
        vm.prank(bob);
        reg.registerAgent(2, SKILL, "ipfs://y");

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        // owner can prune
        reg.pruneInactive(ids);
        assertFalse(reg.isActive(1));
        assertFalse(reg.isActive(2));
    }

    function test_pruneInactive_revert_notOwner() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.prank(bob);
        vm.expectRevert();
        reg.pruneInactive(ids);
    }

    function test_pruneInactive_skipsAlreadyDeactivated() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");
        vm.prank(alice);
        reg.deregisterAgent(1);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        // Should not revert, just no-op on already deactivated
        reg.pruneInactive(ids);
        assertFalse(reg.isActive(1));
    }

    function test_pruneInactive_canBeReactivated() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        reg.pruneInactive(ids);
        assertFalse(reg.isActive(1));

        // Controller can still reactivate
        vm.prank(alice);
        reg.reactivateAgent(1);
        assertTrue(reg.isActive(1));
    }

    // ─── getActiveAgentIds (paginated) ───────────────────────────────────────────

    function test_getActiveAgentIds_excludesInactive() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");
        vm.prank(alice);
        reg.registerAgent(2, SKILL, "ipfs://y");
        vm.prank(bob);
        reg.registerAgent(3, SKILL, "ipfs://z");

        // Deactivate #2
        vm.prank(alice);
        reg.deregisterAgent(2);

        uint256[] memory active = reg.getActiveAgentIds(0, 10);
        assertEq(active.length, 2);
        assertEq(active[0], 1);
        assertEq(active[1], 3);

        assertEq(reg.totalAgents(), 3);
    }

    function test_getActiveAgentIds_pagination() public {
        for (uint256 i = 1; i <= 5; i++) {
            vm.prank(alice);
            reg.registerAgent(i, SKILL, "ipfs://x");
        }

        uint256[] memory page1 = reg.getActiveAgentIds(0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0], 1);
        assertEq(page1[1], 2);

        uint256[] memory page2 = reg.getActiveAgentIds(2, 2);
        assertEq(page2.length, 2);
        assertEq(page2[0], 3);
        assertEq(page2[1], 4);
    }

    // ─── heartbeat ───────────────────────────────────────────────────────────────

    function test_heartbeat_updatesLastActiveAt() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");
        uint256 t0 = reg.getAgent(1).lastActiveAt;

        vm.warp(block.timestamp + 3600);
        vm.prank(alice);
        reg.heartbeat(1);

        uint256 t1 = reg.getAgent(1).lastActiveAt;
        assertGt(t1, t0);
    }

    function test_heartbeat_revert_notController() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");

        vm.prank(bob);
        vm.expectRevert(bytes("Not controller"));
        reg.heartbeat(1);
    }

    // ─── updateAgent touches lastActiveAt ────────────────────────────────────────

    function test_updateAgent_touchesLastActiveAt() public {
        vm.prank(alice);
        reg.registerAgent(1, SKILL, "ipfs://x");
        uint256 t0 = reg.getAgent(1).lastActiveAt;

        vm.warp(block.timestamp + 600);
        vm.prank(alice);
        reg.updateAgent(1, SKILL, "ipfs://x2");

        assertGt(reg.getAgent(1).lastActiveAt, t0);
    }
}
