// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AgentRegistry.sol";
import "./WorkProof.sol";

/// @title ReputationOracle
/// @notice Computes simple work-proof-based agent reputation scores.
contract ReputationOracle {
    AgentRegistry public immutable agentRegistry;
    WorkProof public immutable workProof;

    uint256 public constant RECENCY_WINDOW = 30 days;
    uint256 public constant RECENCY_BONUS_BPS = 2_000;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    constructor(address agentRegistry_, address workProof_) {
        require(agentRegistry_ != address(0), "Invalid registry");
        require(workProof_ != address(0), "Invalid work proof");

        agentRegistry = AgentRegistry(agentRegistry_);
        workProof = WorkProof(workProof_);
    }

    function getScore(uint256 agentId) external view returns (uint256) {
        AgentRegistry.AgentRecord memory agent = agentRegistry.getAgent(agentId);
        uint256[] memory tokenIds = workProof.getProofsByAgent(agentId);

        if (tokenIds.length == 0) {
            return agent.reputationScore;
        }

        uint256 totalPaid;
        uint256 weightedPaid;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            WorkProof.ProofRecord memory proof = workProof.getProof(tokenIds[i]);
            totalPaid += proof.amountPaid;

            uint256 value = proof.amountPaid;
            if (block.timestamp <= proof.mintedAt + RECENCY_WINDOW) {
                value += (proof.amountPaid * RECENCY_BONUS_BPS) / BPS_DENOMINATOR;
            }
            weightedPaid += value;
        }

        uint256 avgPaid = totalPaid / tokenIds.length;
        return tokenIds.length * avgPaid + weightedPaid;
    }
}
