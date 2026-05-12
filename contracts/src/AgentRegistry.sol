// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentRegistry
/// @notice Records agent capability metadata linked to an Arc-compatible agent identity.
contract AgentRegistry is Ownable {
    struct AgentRecord {
        uint256 agentId;
        bytes32 skillHash;
        string metadataURI;
        address controller;
        uint256 registeredAt;
        uint256 reputationScore;
        bool exists;
    }

    mapping(uint256 => AgentRecord) private agents;

    event AgentRegistered(
        uint256 indexed agentId,
        bytes32 indexed skillHash,
        address indexed controller,
        string metadataURI
    );
    event AgentMetadataUpdated(uint256 indexed agentId, bytes32 indexed skillHash, string metadataURI);
    event AgentControllerUpdated(uint256 indexed agentId, address indexed controller);
    event ReputationScoreUpdated(uint256 indexed agentId, uint256 reputationScore);

    constructor() Ownable(msg.sender) {}

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
            reputationScore: 0,
            exists: true
        });

        emit AgentRegistered(agentId, skillHash, msg.sender, metadataURI);
    }

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

    function getAgent(uint256 agentId) external view returns (AgentRecord memory) {
        require(agents[agentId].exists, "Agent missing");
        return agents[agentId];
    }

    function exists(uint256 agentId) external view returns (bool) {
        return agents[agentId].exists;
    }
}
