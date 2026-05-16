// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title A2AReputationRegistry
/// @notice Performance-weighted reputation from verifiable on-chain outcomes.
///         Scores agents on delivery, signal correctness, PnL, and calibration.
///         Upgrades ERC-8004 flat feedback with objective market-outcome scoring.
contract A2AReputationRegistry is Ownable {
    struct Stats {
        uint64 callsServed;
        uint64 callsFailed;
        uint64 signalsCorrect;
        uint64 signalsWrong;
        int128 cumulativePnlBps;
        uint64 calibrationScore;     // 0-100 scale
        uint128 totalRevenue;
        int128 reputationScore;
    }

    // ─── Scoring constants ─────────────────────────────────────────────
    int128 public constant DELIVERED_SIGNAL = 10;
    int128 public constant FAILED_DELIVERY = -20;
    int128 public constant CORRECT_SIGNAL = 25;
    int128 public constant WRONG_SIGNAL = -15;
    int128 public constant CALIBRATED_BONUS = 10;
    int128 public constant OVERCONFIDENT_PENALTY = -3;
    int128 public constant MAX_PNL_REWARD = 50;
    int128 public constant MAX_PNL_PENALTY = -50;

    // ─── State ─────────────────────────────────────────────────────────
    mapping(bytes32 => Stats) private agentStats;
    mapping(address => bool) public authorizedOracles;

    event InteractionRecorded(
        bytes32 indexed providerAgentId,
        bytes32 indexed buyerAgentId,
        bytes32 receiptHash,
        uint128 amount,
        bool delivered
    );
    event SignalOutcomeRecorded(
        bytes32 indexed providerAgentId,
        bytes32 receiptHash,
        bool wasCorrect,
        int128 pnlBps,
        uint64 confidence
    );
    event TraderOutcomeRecorded(
        bytes32 indexed traderAgentId,
        bytes32 receiptHash,
        int128 pnlBps,
        bool executed,
        bool riskOk
    );
    event OracleAuthorized(address indexed oracle);
    event OracleRevoked(address indexed oracle);

    error NotAuthorized();
    error InvalidAgent();

    modifier onlyOracle() {
        if (!authorizedOracles[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    constructor() Ownable(msg.sender) {
        authorizedOracles[msg.sender] = true;
    }

    // ─── Admin ─────────────────────────────────────────────────────────
    function authorizeOracle(address oracle) external onlyOwner {
        authorizedOracles[oracle] = true;
        emit OracleAuthorized(oracle);
    }

    function revokeOracle(address oracle) external onlyOwner {
        authorizedOracles[oracle] = false;
        emit OracleRevoked(oracle);
    }

    // ─── Recording ─────────────────────────────────────────────────────

    /// @notice Record a paid A2A interaction (signal delivery or failure).
    function recordInteraction(
        bytes32 providerAgentId,
        bytes32 buyerAgentId,
        bytes32 receiptHash,
        uint128 amount,
        bool delivered
    ) external onlyOracle {
        if (providerAgentId == bytes32(0)) revert InvalidAgent();

        Stats storage s = agentStats[providerAgentId];
        if (delivered) {
            s.callsServed++;
            s.totalRevenue += amount;
            s.reputationScore += DELIVERED_SIGNAL;
        } else {
            s.callsFailed++;
            s.reputationScore += FAILED_DELIVERY;
        }

        emit InteractionRecorded(providerAgentId, buyerAgentId, receiptHash, amount, delivered);
    }

    /// @notice Record signal outcome after market resolution.
    function recordSignalOutcome(
        bytes32 providerAgentId,
        bytes32 receiptHash,
        bool wasCorrect,
        int128 pnlBps,
        uint64 confidence
    ) external onlyOracle {
        if (providerAgentId == bytes32(0)) revert InvalidAgent();

        Stats storage s = agentStats[providerAgentId];
        if (wasCorrect) {
            s.signalsCorrect++;
            s.reputationScore += CORRECT_SIGNAL;
        } else {
            s.signalsWrong++;
            s.reputationScore += WRONG_SIGNAL;
        }

        // PnL contribution (capped)
        int128 pnlContrib = pnlBps;
        if (pnlContrib > MAX_PNL_REWARD) pnlContrib = MAX_PNL_REWARD;
        if (pnlContrib < MAX_PNL_PENALTY) pnlContrib = MAX_PNL_PENALTY;
        s.cumulativePnlBps += pnlBps;
        s.reputationScore += pnlContrib;

        // Calibration: correct + confidence >= 60 = calibrated
        // wrong + confidence >= 60 = overconfident
        if (wasCorrect && confidence >= 60) {
            s.calibrationScore++;
            s.reputationScore += CALIBRATED_BONUS;
        } else if (!wasCorrect && confidence >= 60) {
            s.reputationScore += OVERCONFIDENT_PENALTY;
        }

        emit SignalOutcomeRecorded(providerAgentId, receiptHash, wasCorrect, pnlBps, confidence);
    }

    /// @notice Record trader execution outcome.
    function recordTraderOutcome(
        bytes32 traderAgentId,
        bytes32 receiptHash,
        int128 pnlBps,
        bool executed,
        bool riskOk
    ) external onlyOracle {
        if (traderAgentId == bytes32(0)) revert InvalidAgent();

        Stats storage s = agentStats[traderAgentId];
        if (executed) {
            s.callsServed++;
            s.reputationScore += DELIVERED_SIGNAL;
        }

        // PnL contribution (capped)
        int128 pnlContrib = pnlBps;
        if (pnlContrib > MAX_PNL_REWARD) pnlContrib = MAX_PNL_REWARD;
        if (pnlContrib < MAX_PNL_PENALTY) pnlContrib = MAX_PNL_PENALTY;
        s.cumulativePnlBps += pnlBps;
        s.reputationScore += pnlContrib;

        // Risk discipline bonus
        if (riskOk) {
            s.calibrationScore++;
        }

        emit TraderOutcomeRecorded(traderAgentId, receiptHash, pnlBps, executed, riskOk);
    }

    // ─── Views ─────────────────────────────────────────────────────────

    function getReputation(bytes32 agentId) external view returns (int128) {
        return agentStats[agentId].reputationScore;
    }

    function getStats(bytes32 agentId) external view returns (Stats memory) {
        return agentStats[agentId];
    }
}
