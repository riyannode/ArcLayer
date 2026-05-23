// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title A2AAgentRegistry
/// @notice On-chain identity + discovery registry for ArcLayer autonomous agents.
contract A2AAgentRegistry is Ownable {
    enum AgentRole {
        MARKET_DATA,
        TRADER,
        EXECUTOR,
        ORACLE,
        AGGREGATOR
    }

    struct Agent {
        address owner;
        AgentRole role;
        string endpoint;
        string metadataURI;
        bool active;
        uint64 registeredAt;
        bytes32 agentId;
    }

    mapping(bytes32 => Agent) private agents;
    mapping(address => bytes32[]) private ownerAgents;
    mapping(uint8 => bytes32[]) private roleAgents;

    event AgentRegistered(
        bytes32 indexed agentId,
        address indexed owner,
        AgentRole indexed role,
        string endpoint,
        string metadataURI
    );
    event AgentUpdated(bytes32 indexed agentId, string endpoint, string metadataURI);
    event AgentDeactivated(bytes32 indexed agentId);

    error AgentExists();
    error AgentMissing();
    error NotAgentOwner();
    error InvalidEndpoint();

    constructor() Ownable(msg.sender) {}

    function registerAgent(
        AgentRole role,
        string calldata endpoint,
        string calldata metadataURI
    ) external returns (bytes32 agentId) {
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();

        agentId = keccak256(abi.encodePacked(block.chainid, msg.sender, role, endpoint, block.timestamp, block.number));
        if (agents[agentId].owner != address(0)) revert AgentExists();

        agents[agentId] = Agent({
            owner: msg.sender,
            role: role,
            endpoint: endpoint,
            metadataURI: metadataURI,
            active: true,
            registeredAt: uint64(block.timestamp),
            agentId: agentId
        });

        ownerAgents[msg.sender].push(agentId);
        roleAgents[uint8(role)].push(agentId);

        emit AgentRegistered(agentId, msg.sender, role, endpoint, metadataURI);
    }

    function updateAgent(bytes32 agentId, string calldata endpoint, string calldata metadataURI) external {
        Agent storage agent = agents[agentId];
        if (agent.owner == address(0)) revert AgentMissing();
        if (agent.owner != msg.sender) revert NotAgentOwner();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();

        agent.endpoint = endpoint;
        agent.metadataURI = metadataURI;

        emit AgentUpdated(agentId, endpoint, metadataURI);
    }

    function deactivateAgent(bytes32 agentId) external {
        Agent storage agent = agents[agentId];
        if (agent.owner == address(0)) revert AgentMissing();
        if (agent.owner != msg.sender) revert NotAgentOwner();

        agent.active = false;
        emit AgentDeactivated(agentId);
    }

    function getAgent(bytes32 agentId) external view returns (Agent memory) {
        Agent memory agent = agents[agentId];
        if (agent.owner == address(0)) revert AgentMissing();
        return agent;
    }

    function getAgentsByRole(AgentRole role) external view returns (bytes32[] memory) {
        return roleAgents[uint8(role)];
    }

    function getAgentsByOwner(address owner) external view returns (bytes32[] memory) {
        return ownerAgents[owner];
    }

    function exists(bytes32 agentId) external view returns (bool) {
        return agents[agentId].owner != address(0);
    }
}
