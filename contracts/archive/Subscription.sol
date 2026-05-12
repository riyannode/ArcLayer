// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Subscription - Recurring USDC Payments on Arc Network
/// @notice Create subscription plans and manage recurring USDC payments
contract Subscription is Ownable {
    IERC20 public immutable usdc;

    uint256 public planCounter;
    uint256 public subscriptionCounter;

    struct Plan {
        uint256 id;
        address creator;
        uint256 amount;         // USDC per interval
        uint256 interval;       // seconds (e.g. 30 days = 2592000)
        string name;
        string description;
        bool active;
    }

    struct Sub {
        uint256 id;
        uint256 planId;
        address subscriber;
        uint256 startTime;
        uint256 lastCharged;
        bool active;
    }

    mapping(uint256 => Plan) public plans;
    mapping(uint256 => Sub) public subscriptions;
    mapping(address => uint256[]) public userSubscriptions;

    event SubscriptionPlanCreated(uint256 indexed planId, address indexed creator, uint256 amount, uint256 interval);
    event SubscriptionCreated(uint256 indexed subId, uint256 indexed planId, address indexed subscriber);
    event SubscriptionCharged(uint256 indexed subId, uint256 amount);
    event SubscriptionCancelled(uint256 indexed subId);

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    /// @notice Create a subscription plan
    function createPlan(
        uint256 amount,
        uint256 interval,
        string calldata name,
        string calldata description
    ) external returns (uint256) {
        require(amount > 0, "Amount must be > 0");
        require(interval >= 1 days, "Interval too short");

        uint256 id = planCounter++;
        plans[id] = Plan({
            id: id,
            creator: msg.sender,
            amount: amount,
            interval: interval,
            name: name,
            description: description,
            active: true
        });

        emit SubscriptionPlanCreated(id, msg.sender, amount, interval);
        return id;
    }

    /// @notice Subscribe to a plan (requires prior USDC approval for recurring charges)
    function subscribe(uint256 planId) external returns (uint256) {
        Plan storage plan = plans[planId];
        require(plan.active, "Plan not active");

        uint256 subId = subscriptionCounter++;
        subscriptions[subId] = Sub({
            id: subId,
            planId: planId,
            subscriber: msg.sender,
            startTime: block.timestamp,
            lastCharged: block.timestamp,
            active: true
        });

        userSubscriptions[msg.sender].push(subId);

        // Charge first payment immediately
        _charge(subId);

        emit SubscriptionCreated(subId, planId, msg.sender);
        return subId;
    }

    /// @notice Charge a subscription (callable by anyone - designed for keepers)
    function charge(uint256 subId) external {
        _charge(subId);
    }

    function _charge(uint256 subId) internal {
        Sub storage sub = subscriptions[subId];
        require(sub.active, "Subscription not active");

        Plan storage plan = plans[sub.planId];
        require(
            block.timestamp >= sub.lastCharged + plan.interval,
            "Not ready for charge"
        );

        require(
            usdc.transferFrom(sub.subscriber, plan.creator, plan.amount),
            "USDC charge failed"
        );

        sub.lastCharged = block.timestamp;
        emit SubscriptionCharged(subId, plan.amount);
    }

    /// @notice Cancel a subscription
    function cancelSubscription(uint256 subId) external {
        Sub storage sub = subscriptions[subId];
        require(sub.subscriber == msg.sender, "Not the subscriber");
        require(sub.active, "Already cancelled");

        sub.active = false;
        emit SubscriptionCancelled(subId);
    }

    /// @notice Get subscriptions for a user
    function getUserSubscriptions(address user) external view returns (uint256[] memory) {
        return userSubscriptions[user];
    }

    /// @notice Check if a subscription is ready to charge
    function isReadyToCharge(uint256 subId) external view returns (bool) {
        Sub storage sub = subscriptions[subId];
        if (!sub.active) return false;
        Plan storage plan = plans[sub.planId];
        return block.timestamp >= sub.lastCharged + plan.interval;
    }
}
