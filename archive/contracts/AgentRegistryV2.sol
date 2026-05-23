// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentRegistryV2
/// @notice Agent registry with active/deactivated status, deregister, and future pruning support.
/// @dev Draft for review — NOT deployed. Backward-compatible event signature with V1.
contract AgentRegistryV2 is Ownable {
    // ─── Types ───────────────────────────────────────────────────────────────────

    enum AgentStatus {
        Active,
        Deactivated
    }

    struct AgentRecord {
        uint256 agentId;
        bytes32 skillHash;
        string metadataURI;
        address controller;
        uint256 registeredAt;
        uint256 lastActiveAt;
        uint256 reputationScore;
        AgentStatus status;
        bool exists;
    }

    // ─── State ───────────────────────────────────────────────────────────────────

    mapping(uint256 => AgentRecord) private agents;
    uint256[] private agentIds; // for enumeration

    // ─── Events ──────────────────────────────────────────────────────────────────

    event AgentRegistered(
        uint256 indexed agentId,
        bytes32 indexed skillHash,
        address indexed controller,
        string metadataURI
    );
    event AgentDeregistered(uint256 indexed agentId, address indexed controller);
    event AgentReactivated(uint256 indexed agentId, address indexed controller);
    event AgentMetadataUpdated(uint256 indexed agentId, bytes32 indexed skillHash, string metadataURI);
    event AgentControllerUpdated(uint256 indexed agentId, address indexed controller);
    event ReputationScoreUpdated(uint256 indexed agentId, uint256 reputationScore);
    event AgentsPruned(uint256[] agentIds, address indexed caller);

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Registration ────────────────────────────────────────────────────────────

    function registerAgent(
        uint256 agentId,
        bytes32 skillHash,
        string calldata metadataURI
    ) external {
        require(agentId != 0, "Invalid agent");
        require(!agents[agentId].exists, "Agent exists");

        agents[agentId] = AgentRecord({
            agentId: agentId,
            skillHash: skillHash,
            metadataURI: metadataURI,
            controller: msg.sender,
            registeredAt: block.timestamp,
            lastActiveAt: block.timestamp,
            reputationScore: 0,
            status: AgentStatus.Active,
            exists: true
        });

        agentIds.push(agentId);
        emit AgentRegistered(agentId, skillHash, msg.sender, metadataURI);
    }

    // ─── Deregister / Reactivate ─────────────────────────────────────────────────

    /// @notice Deactivate an agent. Only callable by the agent's controller.
    /// @dev Does NOT delete storage — agent can be reactivated. Indexer/read logic
    ///      should exclude agents with status == Deactivated by default.
    function deregisterAgent(uint256 agentId) external {
        AgentRecord storage agent = agents[agentId];
        require(agent.exists, "Agent missing");
        require(agent.controller == msg.sender, "Not controller");
        require(agent.status == AgentStatus.Active, "Already deactivated");

        agent.status = AgentStatus.Deactivated;
        emit AgentDeregistered(agentId, msg.sender);
    }

    /// @notice Reactivate a previously deactivated agent. Only callable by controller.
    function reactivateAgent(uint256 agentId) external {
        AgentRecord storage agent = agents[agentId];
        require(agent.exists, "Agent missing");
        require(agent.controller == msg.sender, "Not controller");
        require(agent.status == AgentStatus.Deactivated, "Already active");

        agent.status = AgentStatus.Active;
        agent.lastActiveAt = block.timestamp;
        emit AgentReactivated(agentId, msg.sender);
    }

    // ─── Updates ─────────────────────────────────────────────────────────────────

    function updateAgent(
        uint256 agentId,
        bytes32 skillHash,
        string calldata metadataURI
    ) external {
        AgentRecord storage agent = agents[agentId];
        require(agent.exists, "Agent missing");
        require(agent.controller == msg.sender, "Not controller");

        agent.skillHash = skillHash;
        agent.metadataURI = metadataURI;
        agent.lastActiveAt = block.timestamp;

        emit AgentMetadataUpdated(agentId, skillHash, metadataURI);
    }

    function setAgentController(uint256 agentId, address controller) external {
        AgentRecord storage agent = agents[agentId];
        require(agent.exists, "Agent missing");
        require(agent.controller == msg.sender, "Not controller");
        require(controller != address(0), "Invalid controller");

        agent.controller = controller;
        emit AgentControllerUpdated(agentId, controller);
    }

    function setReputationScore(uint256 agentId, uint256 reputationScore) external onlyOwner {
        AgentRecord storage agent = agents[agentId];
        require(agent.exists, "Agent missing");

        agent.reputationScore = reputationScore;
        emit ReputationScoreUpdated(agentId, reputationScore);
    }

    /// @notice Touch lastActiveAt — callable by controller to signal liveness.
    function heartbeat(uint256 agentId) external {
        AgentRecord storage agent = agents[agentId];
        require(agent.exists, "Agent missing");
        require(agent.controller == msg.sender, "Not controller");

        agent.lastActiveAt = block.timestamp;
    }

    // ─── Pruning (future feature, owner-only) ────────────────────────────────────

    /// @notice Mark inactive agents as Deactivated. Does NOT auto-delete.
    /// @dev Only callable by contract owner. Intended for future governance/cron.
    ///      Agents can still be reactivated by their controller after pruning.
    function pruneInactive(uint256[] calldata ids) external onlyOwner {
        for (uint256 i = 0; i < ids.length; i++) {
            AgentRecord storage agent = agents[ids[i]];
            if (agent.exists && agent.status == AgentStatus.Active) {
                agent.status = AgentStatus.Deactivated;
                emit AgentDeregistered(ids[i], agent.controller);
            }
        }
        emit AgentsPruned(ids, msg.sender);
    }

    // ─── Read (excludes inactive by default) ─────────────────────────────────────

    function getAgent(uint256 agentId) external view returns (AgentRecord memory) {
        require(agents[agentId].exists, "Agent missing");
        return agents[agentId];
    }

    function getActiveAgent(uint256 agentId) external view returns (AgentRecord memory) {
        AgentRecord memory agent = agents[agentId];
        require(agent.exists, "Agent missing");
        require(agent.status == AgentStatus.Active, "Agent inactive");
        return agent;
    }

    function exists(uint256 agentId) external view returns (bool) {
        return agents[agentId].exists;
    }

    function isActive(uint256 agentId) external view returns (bool) {
        return agents[agentId].exists && agents[agentId].status == AgentStatus.Active;
    }

    /// @notice Return count of all registered agents (including deactivated).
    function totalAgents() external view returns (uint256) {
        return agentIds.length;
    }

    /// @notice Paginated list of active agent IDs for indexer consumption.
    /// @param offset Start index in the agentIds array.
    /// @param limit Max number of active IDs to return.
    function getActiveAgentIds(uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        uint256[] memory result = new uint256[](limit);
        uint256 count = 0;
        for (uint256 i = offset; i < agentIds.length && count < limit; i++) {
            if (agents[agentIds[i]].status == AgentStatus.Active) {
                result[count] = agentIds[i];
                count++;
            }
        }
        // Trim to actual count
        uint256[] memory trimmed = new uint256[](count);
        for (uint256 j = 0; j < count; j++) {
            trimmed[j] = result[j];
        }
        return trimmed;
    }
}
