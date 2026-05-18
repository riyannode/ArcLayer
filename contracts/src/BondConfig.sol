// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BondConfig
/// @notice Admin-configurable performance bond tiers for jobbers.
///         Rates adjustable via multi-sig owner (Safe recommended).
contract BondConfig {
    struct Tier {
        uint256 minAmount;   // inclusive, in USDC (6 decimals)
        uint256 maxAmount;   // exclusive, type(uint256).max for uncapped
        bool isFlat;         // true = flatBond used, false = percentageBps used
        uint256 flatBond;    // flat USDC amount (6 decimals)
        uint256 percentBps;  // basis points (100 = 1%)
    }

    address public owner;
    address public pendingOwner;

    Tier[] public tiers;

    // Veteran discount
    uint256 public veteranJobThreshold = 10;
    uint256 public veteranRatingMin = 470; // 4.70 * 100
    uint256 public veteranDiscountBps = 3000; // 30%

    event TierAdded(uint256 indexed index, uint256 minAmount, uint256 maxAmount);
    event TierUpdated(uint256 indexed index);
    event TiersReset();
    event VeteranConfigUpdated(uint256 jobThreshold, uint256 ratingMin, uint256 discountBps);
    event OwnershipTransferStarted(address indexed current, address indexed pending);
    event OwnershipTransferred(address indexed previous, address indexed current);

    modifier onlyOwner() {
        require(msg.sender == owner, "BondConfig: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        _initDefaultTiers();
    }

    // ─── Default 7 Tiers ───────────────────────────────────────────────
    function _initDefaultTiers() internal {
        // Tier 1: < $50 → free
        tiers.push(Tier(0, 50e6, true, 0, 0));
        // Tier 2: $50-$300 → $5 flat
        tiers.push(Tier(50e6, 300e6, true, 5e6, 0));
        // Tier 3: $300-$500 → 1%
        tiers.push(Tier(300e6, 500e6, false, 0, 100));
        // Tier 4: $500-$1000 → 2%
        tiers.push(Tier(500e6, 1000e6, false, 0, 200));
        // Tier 5: $1000-$2000 → 3%
        tiers.push(Tier(1000e6, 2000e6, false, 0, 300));
        // Tier 6: $2000-$3000 → 4.5%
        tiers.push(Tier(2000e6, 3000e6, false, 0, 450));
        // Tier 7: >$3000 → 6%
        tiers.push(Tier(3000e6, type(uint256).max, false, 0, 600));
    }

    // ─── Calculate Bond ────────────────────────────────────────────────
    function calculateBond(
        uint256 jobAmount,
        uint256 completedJobs,
        uint256 ratingX100 // e.g. 470 = 4.70
    ) external view returns (uint256 bondAmount) {
        bondAmount = _rawBond(jobAmount);

        // Apply veteran discount
        if (completedJobs >= veteranJobThreshold && ratingX100 >= veteranRatingMin) {
            bondAmount = bondAmount * (10000 - veteranDiscountBps) / 10000;
        }
    }

    function _rawBond(uint256 jobAmount) internal view returns (uint256) {
        for (uint256 i = 0; i < tiers.length; i++) {
            if (jobAmount >= tiers[i].minAmount && jobAmount < tiers[i].maxAmount) {
                if (tiers[i].isFlat) {
                    return tiers[i].flatBond;
                } else {
                    return (jobAmount * tiers[i].percentBps) / 10000;
                }
            }
        }
        // Fallback: last tier percentage
        Tier memory last = tiers[tiers.length - 1];
        return (jobAmount * last.percentBps) / 10000;
    }

    // M3: Timelock for tier changes — prevents instant bond manipulation
    uint256 public constant TIER_TIMELOCK = 24 hours;

    struct PendingTierChange {
        bytes32 changeHash;
        uint256 executeAfter;
    }
    PendingTierChange public pendingTierChange;

    event TierChangeQueued(bytes32 changeHash, uint256 executeAfter);
    event TierChangeCancelled();

    // ─── Admin: Update Tiers (timelocked) ────────────────────────────────
    function queueUpdateTier(
        uint256 index,
        uint256 minAmount,
        uint256 maxAmount,
        bool isFlat,
        uint256 flatBond,
        uint256 percentBps
    ) external onlyOwner {
        require(index < tiers.length, "BondConfig: invalid index");
        require(percentBps <= 1000, "BondConfig: max 10%");
        bytes32 h = keccak256(abi.encode("update", index, minAmount, maxAmount, isFlat, flatBond, percentBps));
        pendingTierChange = PendingTierChange({ changeHash: h, executeAfter: block.timestamp + TIER_TIMELOCK });
        emit TierChangeQueued(h, pendingTierChange.executeAfter);
    }

    function executeUpdateTier(
        uint256 index,
        uint256 minAmount,
        uint256 maxAmount,
        bool isFlat,
        uint256 flatBond,
        uint256 percentBps
    ) external onlyOwner {
        require(pendingTierChange.executeAfter != 0, "BondConfig: no pending");
        require(block.timestamp >= pendingTierChange.executeAfter, "BondConfig: timelock active");
        bytes32 h = keccak256(abi.encode("update", index, minAmount, maxAmount, isFlat, flatBond, percentBps));
        require(pendingTierChange.changeHash == h, "BondConfig: hash mismatch");
        delete pendingTierChange;
        tiers[index] = Tier(minAmount, maxAmount, isFlat, flatBond, percentBps);
        emit TierUpdated(index);
    }

    function queueAddTier(
        uint256 minAmount,
        uint256 maxAmount,
        bool isFlat,
        uint256 flatBond,
        uint256 percentBps
    ) external onlyOwner {
        require(percentBps <= 1000, "BondConfig: max 10%");
        bytes32 h = keccak256(abi.encode("add", minAmount, maxAmount, isFlat, flatBond, percentBps));
        pendingTierChange = PendingTierChange({ changeHash: h, executeAfter: block.timestamp + TIER_TIMELOCK });
        emit TierChangeQueued(h, pendingTierChange.executeAfter);
    }

    function executeAddTier(
        uint256 minAmount,
        uint256 maxAmount,
        bool isFlat,
        uint256 flatBond,
        uint256 percentBps
    ) external onlyOwner {
        require(pendingTierChange.executeAfter != 0, "BondConfig: no pending");
        require(block.timestamp >= pendingTierChange.executeAfter, "BondConfig: timelock active");
        bytes32 h = keccak256(abi.encode("add", minAmount, maxAmount, isFlat, flatBond, percentBps));
        require(pendingTierChange.changeHash == h, "BondConfig: hash mismatch");
        delete pendingTierChange;
        tiers.push(Tier(minAmount, maxAmount, isFlat, flatBond, percentBps));
        emit TierAdded(tiers.length - 1, minAmount, maxAmount);
    }

    function cancelTierChange() external onlyOwner {
        delete pendingTierChange;
        emit TierChangeCancelled();
    }

    function resetTiers() external onlyOwner {
        delete tiers;
        _initDefaultTiers();
        emit TiersReset();
    }

    function tierCount() external view returns (uint256) {
        return tiers.length;
    }

    // ─── Admin: Veteran Config ─────────────────────────────────────────
    function setVeteranConfig(
        uint256 _jobThreshold,
        uint256 _ratingMin,
        uint256 _discountBps
    ) external onlyOwner {
        require(_discountBps <= 5000, "BondConfig: max 50% discount");
        veteranJobThreshold = _jobThreshold;
        veteranRatingMin = _ratingMin;
        veteranDiscountBps = _discountBps;
        emit VeteranConfigUpdated(_jobThreshold, _ratingMin, _discountBps);
    }

    // ─── Ownership (2-step) ────────────────────────────────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "BondConfig: zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "BondConfig: not pending");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
