// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Ignia — Binary Prediction Market
 * @notice Stablecoin-native agent prediction market on Arc Testnet.
 *         Pythia resolves, Hermes trades. Settled in USDC.
 *
 * Mechanics:
 *   - Market has YES/NO outcome shares priced via constant-product AMM (x*y=k)
 *   - Anyone can buy/sell shares with USDC
 *   - Oracle (Pythia) resolves the market
 *   - Winners claim USDC proportional to shares held
 *
 * Designed for Arc-native AI prediction markets: USDC execution, oracle resolution, deterministic settlement.
 */
contract Ignia is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ───────────────────────────────────────────────────────────
    enum Outcome { UNRESOLVED, YES, NO }
    enum Side { YES, NO }

    struct Market {
        string question;          // e.g. "BTC > $105,000 by May 25?"
        uint256 yesShares;        // AMM pool YES liquidity
        uint256 noShares;         // AMM pool NO liquidity
        uint256 totalYesBought;   // total YES shares outstanding
        uint256 totalNoBought;    // total NO shares outstanding
        uint256 createdAt;
        uint256 resolvedAt;
        uint256 resolutionDeadline;
        Outcome outcome;
        bool settled;
    }

    // ─── State ───────────────────────────────────────────────────────────
    IERC20 public immutable usdc;
    address public oracle;        // Pythia agent address
    address public admin;

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    // marketId => user => side => shares
    mapping(uint256 => mapping(address => uint256)) public yesBalances;
    mapping(uint256 => mapping(address => uint256)) public noBalances;
    // marketId => total USDC deposited (for settlement pool)
    mapping(uint256 => uint256) public pools;

    uint256 public constant FEE_BPS = 30; // 0.3% swap fee
    uint256 public constant INITIAL_LIQUIDITY = 1_000_000; // 1 USDC worth each side (6 dec)

    // ─── Events ──────────────────────────────────────────────────────────
    event MarketCreated(uint256 indexed marketId, string question, uint256 deadline);
    event SharesBought(uint256 indexed marketId, address indexed buyer, Side side, uint256 shares, uint256 cost);
    event SharesSold(uint256 indexed marketId, address indexed seller, Side side, uint256 shares, uint256 payout);
    event MarketResolved(uint256 indexed marketId, Outcome outcome, address oracle);
    event WinningsClaimed(uint256 indexed marketId, address indexed claimer, uint256 amount);

    // ─── Errors ──────────────────────────────────────────────────────────
    error OnlyOracle();
    error OnlyAdmin();
    error MarketNotActive();
    error MarketNotResolved();
    error AlreadyClaimed();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error InsufficientShares();
    error ZeroAmount();

    // ─── Constructor ─────────────────────────────────────────────────────
    constructor(address _usdc, address _oracle) {
        usdc = IERC20(_usdc);
        oracle = _oracle;
        admin = msg.sender;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────
    modifier onlyOracle() {
        if (msg.sender != oracle) revert OnlyOracle();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    // ─── Admin ───────────────────────────────────────────────────────────
    function setOracle(address _oracle) external onlyAdmin {
        oracle = _oracle;
    }

    // ─── Create Market ───────────────────────────────────────────────────
    /**
     * @notice Create a new binary prediction market.
     * @param question Human-readable question
     * @param deadline Unix timestamp after which oracle can resolve
     * @param seedUsdc USDC amount to seed initial liquidity (both sides)
     */
    function createMarket(
        string calldata question,
        uint256 deadline,
        uint256 seedUsdc
    ) external returns (uint256 marketId) {
        if (seedUsdc == 0) revert ZeroAmount();

        marketId = marketCount++;

        // Seed AMM with equal liquidity on both sides
        // Each side gets seedUsdc worth of shares
        markets[marketId] = Market({
            question: question,
            yesShares: seedUsdc,
            noShares: seedUsdc,
            totalYesBought: 0,
            totalNoBought: 0,
            createdAt: block.timestamp,
            resolvedAt: 0,
            resolutionDeadline: deadline,
            outcome: Outcome.UNRESOLVED,
            settled: false
        });

        // Transfer seed USDC from creator
        // Total pool = 2 * seedUsdc (one for each side)
        usdc.safeTransferFrom(msg.sender, address(this), seedUsdc * 2);
        pools[marketId] = seedUsdc * 2;

        emit MarketCreated(marketId, question, deadline);
    }

    // ─── Buy Shares ──────────────────────────────────────────────────────
    /**
     * @notice Buy YES or NO shares using USDC.
     * @param marketId Market to trade on
     * @param side YES or NO
     * @param usdcAmount USDC to spend
     * @return sharesOut Number of shares received
     */
    function buyShares(
        uint256 marketId,
        Side side,
        uint256 usdcAmount
    ) external nonReentrant returns (uint256 sharesOut) {
        Market storage m = markets[marketId];
        if (m.outcome != Outcome.UNRESOLVED) revert MarketNotActive();
        if (usdcAmount == 0) revert ZeroAmount();

        // Apply fee
        uint256 fee = (usdcAmount * FEE_BPS) / 10_000;
        uint256 amountAfterFee = usdcAmount - fee;

        // CPMM: x * y = k
        // Buying YES: remove from YES pool, add to NO pool
        // sharesOut = yesShares - k / (noShares + amountAfterFee)
        if (side == Side.YES) {
            uint256 k = m.yesShares * m.noShares;
            uint256 newNo = m.noShares + amountAfterFee;
            sharesOut = m.yesShares - (k / newNo);
            m.yesShares -= sharesOut;
            m.noShares = newNo;
            m.totalYesBought += sharesOut;
            yesBalances[marketId][msg.sender] += sharesOut;
        } else {
            uint256 k = m.yesShares * m.noShares;
            uint256 newYes = m.yesShares + amountAfterFee;
            sharesOut = m.noShares - (k / newYes);
            m.noShares -= sharesOut;
            m.yesShares = newYes;
            m.totalNoBought += sharesOut;
            noBalances[marketId][msg.sender] += sharesOut;
        }

        // Transfer USDC in
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        pools[marketId] += usdcAmount;

        emit SharesBought(marketId, msg.sender, side, sharesOut, usdcAmount);
    }

    // ─── Sell Shares ─────────────────────────────────────────────────────
    /**
     * @notice Sell shares back to the AMM for USDC.
     */
    function sellShares(
        uint256 marketId,
        Side side,
        uint256 sharesAmount
    ) external nonReentrant returns (uint256 usdcOut) {
        Market storage m = markets[marketId];
        if (m.outcome != Outcome.UNRESOLVED) revert MarketNotActive();
        if (sharesAmount == 0) revert ZeroAmount();

        if (side == Side.YES) {
            if (yesBalances[marketId][msg.sender] < sharesAmount) revert InsufficientShares();
            uint256 k = m.yesShares * m.noShares;
            uint256 newYes = m.yesShares + sharesAmount;
            usdcOut = m.noShares - (k / newYes);
            m.yesShares = newYes;
            m.noShares -= usdcOut;
            m.totalYesBought -= sharesAmount;
            yesBalances[marketId][msg.sender] -= sharesAmount;
        } else {
            if (noBalances[marketId][msg.sender] < sharesAmount) revert InsufficientShares();
            uint256 k = m.yesShares * m.noShares;
            uint256 newNo = m.noShares + sharesAmount;
            usdcOut = m.yesShares - (k / newNo);
            m.noShares = newNo;
            m.yesShares -= usdcOut;
            m.totalNoBought -= sharesAmount;
            noBalances[marketId][msg.sender] -= sharesAmount;
        }

        // Apply fee on exit
        uint256 fee = (usdcOut * FEE_BPS) / 10_000;
        usdcOut -= fee;

        usdc.safeTransfer(msg.sender, usdcOut);
        pools[marketId] -= usdcOut;

        emit SharesSold(marketId, msg.sender, side, sharesAmount, usdcOut);
    }

    // ─── Resolve Market ──────────────────────────────────────────────────
    /**
     * @notice Oracle resolves the market outcome.
     * @param marketId Market to resolve
     * @param outcome YES or NO (not UNRESOLVED)
     */
    function resolveMarket(
        uint256 marketId,
        Outcome outcome
    ) external onlyOracle {
        Market storage m = markets[marketId];
        if (m.outcome != Outcome.UNRESOLVED) revert MarketNotActive();
        if (block.timestamp < m.resolutionDeadline) revert DeadlineNotPassed();
        if (outcome == Outcome.UNRESOLVED) revert ZeroAmount();

        m.outcome = outcome;
        m.resolvedAt = block.timestamp;

        emit MarketResolved(marketId, outcome, msg.sender);
    }

    // ─── Claim Winnings ──────────────────────────────────────────────────
    /**
     * @notice Winners claim their USDC after resolution.
     *         Payout = (userShares / totalWinningShares) * pool
     */
    function claimWinnings(uint256 marketId) external nonReentrant returns (uint256 payout) {
        Market storage m = markets[marketId];
        if (m.outcome == Outcome.UNRESOLVED) revert MarketNotResolved();

        uint256 userShares;
        uint256 totalWinning;

        if (m.outcome == Outcome.YES) {
            userShares = yesBalances[marketId][msg.sender];
            totalWinning = m.totalYesBought;
            yesBalances[marketId][msg.sender] = 0;
        } else {
            userShares = noBalances[marketId][msg.sender];
            totalWinning = m.totalNoBought;
            noBalances[marketId][msg.sender] = 0;
        }

        if (userShares == 0) revert InsufficientShares();

        // Pro-rata share of the pool
        payout = (pools[marketId] * userShares) / totalWinning;
        usdc.safeTransfer(msg.sender, payout);

        emit WinningsClaimed(marketId, msg.sender, payout);
    }

    // ─── View Functions ──────────────────────────────────────────────────
    /**
     * @notice Get current YES probability (0-1e6 scale, i.e. 500000 = 50%)
     */
    function getYesProbability(uint256 marketId) external view returns (uint256) {
        Market storage m = markets[marketId];
        if (m.yesShares + m.noShares == 0) return 500_000;
        // P(YES) = noShares / (yesShares + noShares)
        // (more NO shares in pool = YES is more expensive = higher YES prob)
        return (m.noShares * 1_000_000) / (m.yesShares + m.noShares);
    }

    /**
     * @notice Get market info
     */
    function getMarket(uint256 marketId) external view returns (
        string memory question,
        uint256 yesShares,
        uint256 noShares,
        uint256 totalYesBought,
        uint256 totalNoBought,
        uint256 pool,
        Outcome outcome,
        uint256 resolutionDeadline
    ) {
        Market storage m = markets[marketId];
        return (
            m.question,
            m.yesShares,
            m.noShares,
            m.totalYesBought,
            m.totalNoBought,
            pools[marketId],
            m.outcome,
            m.resolutionDeadline
        );
    }

    /**
     * @notice Quote how many shares you'd get for a given USDC amount
     */
    function quoteShares(
        uint256 marketId,
        Side side,
        uint256 usdcAmount
    ) external view returns (uint256 sharesOut) {
        Market storage m = markets[marketId];
        uint256 fee = (usdcAmount * FEE_BPS) / 10_000;
        uint256 amountAfterFee = usdcAmount - fee;

        if (side == Side.YES) {
            uint256 k = m.yesShares * m.noShares;
            uint256 newNo = m.noShares + amountAfterFee;
            sharesOut = m.yesShares - (k / newNo);
        } else {
            uint256 k = m.yesShares * m.noShares;
            uint256 newYes = m.yesShares + amountAfterFee;
            sharesOut = m.noShares - (k / newYes);
        }
    }
}
