// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AgentRegistry.sol";
import "./WorkProof.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title JobEscrow
/// @notice Escrow settlement layer for agent-to-agent jobs on Arc.
contract JobEscrow {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    AgentRegistry public immutable agentRegistry;
    WorkProof public immutable workProof;
    address public owner;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_PLATFORM_FEE_BPS = 500;
    uint256 public platformFeeBps = 50;
    uint256 public jobCounter;

    enum JobStatus {
        Created,
        Budgeted,
        Funded,
        Submitted,
        Evaluated,
        Settled,
        Cancelled
    }

    struct Job {
        uint256 id;
        uint256 agentId;
        address client;
        address worker;
        address evaluator;
        uint256 budget;
        uint256 fundedAmount;
        uint256 createdAt;
        bytes32 jobSpecHash;
        string deliverableURI;
        string proofMetadataURI;
        bool approved;
        JobStatus status;
    }

    mapping(uint256 => Job) public jobs;
    mapping(address => uint256[]) private userJobs;
    mapping(uint256 => uint256[]) private jobsByAgentId;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PlatformFeeUpdated(uint256 feeBps);
    event JobCreated(
        uint256 indexed jobId,
        uint256 indexed agentId,
        address indexed client,
        address worker,
        address evaluator,
        bytes32 jobSpecHash
    );
    event JobBudgetSet(uint256 indexed jobId, uint256 budget);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event DeliverableSubmitted(uint256 indexed jobId, string deliverableURI);
    event JobEvaluated(uint256 indexed jobId, address indexed evaluator, bool approved);
    event JobSettled(
        uint256 indexed jobId,
        uint256 indexed agentId,
        address indexed worker,
        uint256 payout,
        uint256 fee
    );
    event JobCancelled(uint256 indexed jobId);
    event JobRefunded(uint256 indexed jobId, address indexed client, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyExistingJob(uint256 jobId) {
        require(jobs[jobId].client != address(0), "Job not found");
        _;
    }

    constructor(address usdc_, address agentRegistry_, address workProof_) {
        require(usdc_ != address(0), "Invalid USDC");
        require(agentRegistry_ != address(0), "Invalid registry");
        require(workProof_ != address(0), "Invalid work proof");

        usdc = IERC20(usdc_);
        agentRegistry = AgentRegistry(agentRegistry_);
        workProof = WorkProof(workProof_);
        owner = msg.sender;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    function createJob(
        uint256 agentId,
        address worker,
        address evaluator,
        bytes32 jobSpecHash
    ) external returns (uint256 jobId) {
        require(worker != address(0), "Invalid worker");
        require(evaluator != address(0), "Invalid evaluator");
        require(worker != msg.sender, "Worker is client");
        require(agentRegistry.exists(agentId), "Agent missing");

        jobId = ++jobCounter;
        jobs[jobId] = Job({
            id: jobId,
            agentId: agentId,
            client: msg.sender,
            worker: worker,
            evaluator: evaluator,
            budget: 0,
            fundedAmount: 0,
            createdAt: block.timestamp,
            jobSpecHash: jobSpecHash,
            deliverableURI: "",
            proofMetadataURI: "",
            approved: false,
            status: JobStatus.Created
        });

        userJobs[msg.sender].push(jobId);
        userJobs[worker].push(jobId);
        userJobs[evaluator].push(jobId);
        jobsByAgentId[agentId].push(jobId);

        emit JobCreated(jobId, agentId, msg.sender, worker, evaluator, jobSpecHash);
    }

    function setBudget(uint256 jobId, uint256 budget) external onlyExistingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "Not client");
        require(job.status == JobStatus.Created || job.status == JobStatus.Budgeted, "Not budgetable");
        require(budget > 0, "Invalid budget");

        job.budget = budget;
        job.status = JobStatus.Budgeted;

        emit JobBudgetSet(jobId, budget);
    }

    function fund(uint256 jobId, uint256 amount) external onlyExistingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "Not client");
        require(job.status == JobStatus.Budgeted || job.status == JobStatus.Funded, "Not fundable");
        require(job.budget > 0, "Budget unset");
        require(amount > 0, "Invalid amount");
        require(job.fundedAmount + amount <= job.budget, "Overfunded");

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        job.fundedAmount += amount;
        if (job.fundedAmount == job.budget) {
            job.status = JobStatus.Funded;
        }

        emit JobFunded(jobId, msg.sender, amount);
    }

    function submitDeliverable(
        uint256 jobId,
        string calldata deliverableURI,
        string calldata proofMetadataURI
    ) external onlyExistingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.worker, "Not worker");
        require(job.status == JobStatus.Funded, "Not submitable");

        job.deliverableURI = deliverableURI;
        job.proofMetadataURI = proofMetadataURI;
        job.status = JobStatus.Submitted;

        emit DeliverableSubmitted(jobId, deliverableURI);
    }

    function evaluate(uint256 jobId, bool approved) external onlyExistingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.evaluator, "Not evaluator");
        require(job.status == JobStatus.Submitted, "Not evaluable");

        job.approved = approved;
        job.status = JobStatus.Evaluated;

        emit JobEvaluated(jobId, msg.sender, approved);
    }

    function settle(uint256 jobId) external onlyExistingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.evaluator || msg.sender == job.client, "Not authorized");
        require(job.status == JobStatus.Evaluated, "Not settleable");
        require(job.approved, "Not approved");
        require(job.fundedAmount == job.budget, "Underfunded");

        uint256 fee = (job.budget * platformFeeBps) / BPS_DENOMINATOR;
        uint256 payout = job.budget - fee;

        job.status = JobStatus.Settled;

        usdc.safeTransfer(job.worker, payout);
        if (fee > 0) {
            usdc.safeTransfer(owner, fee);
        }

        workProof.mintProof(
            job.worker,
            job.id,
            job.agentId,
            job.client,
            payout,
            job.proofMetadataURI
        );

        emit JobSettled(jobId, job.agentId, job.worker, payout, fee);
    }

    function refundRejected(uint256 jobId) external onlyExistingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client || msg.sender == job.evaluator, "Not authorized");
        require(job.status == JobStatus.Evaluated, "Not refundable");
        require(!job.approved, "Job approved");
        require(job.fundedAmount > 0, "Nothing to refund");

        uint256 refund = job.fundedAmount;
        job.status = JobStatus.Settled;
        job.fundedAmount = 0;

        usdc.safeTransfer(job.client, refund);

        emit JobRefunded(jobId, job.client, refund);
    }

    function cancelJob(uint256 jobId) external onlyExistingJob(jobId) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client || msg.sender == job.worker || msg.sender == owner, "Not participant");
        require(job.status == JobStatus.Created || job.status == JobStatus.Budgeted, "Already funded");

        job.status = JobStatus.Cancelled;
        emit JobCancelled(jobId);
    }

    function getUserJobs(address user) external view returns (uint256[] memory) {
        return userJobs[user];
    }

    function getJobsByAgentId(uint256 agentId) external view returns (uint256[] memory) {
        return jobsByAgentId[agentId];
    }

    function setPlatformFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= MAX_PLATFORM_FEE_BPS, "Fee too high");
        platformFeeBps = feeBps;
        emit PlatformFeeUpdated(feeBps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
