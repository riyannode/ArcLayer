// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title MilestoneEscrow
/// @notice USDC milestone escrow for service work settled on Arc.
contract MilestoneEscrow {
    IERC20Like public immutable usdc;
    address public owner;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_PLATFORM_FEE_BPS = 500;
    uint256 public platformFeeBps = 50;
    uint256 public projectCounter;

    enum ProjectStatus {
        Created,
        Funded,
        Completed,
        Cancelled
    }

    enum MilestoneStatus {
        Created,
        Funded,
        Submitted,
        Released
    }

    struct Project {
        uint256 id;
        address freelancer;
        address client;
        uint256 totalAmount;
        uint256 releasedAmount;
        uint256 createdAt;
        uint256 milestoneCount;
        string title;
        string description;
        ProjectStatus status;
    }

    struct Milestone {
        uint256 id;
        uint256 projectId;
        uint256 amount;
        uint256 submittedAt;
        uint256 releasedAt;
        string title;
        string deliverableURI;
        MilestoneStatus status;
    }

    mapping(uint256 => Project) public projects;
    mapping(uint256 => mapping(uint256 => Milestone)) public milestones;
    mapping(address => uint256[]) private userProjects;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PlatformFeeUpdated(uint256 feeBps);
    event ProjectCreated(
        uint256 indexed projectId,
        address indexed freelancer,
        address indexed client,
        uint256 totalAmount
    );
    event ProjectFunded(uint256 indexed projectId, address indexed client, uint256 totalAmount);
    event ProjectCancelled(uint256 indexed projectId);
    event MilestoneSubmitted(uint256 indexed projectId, uint256 indexed milestoneId, string deliverableURI);
    event MilestoneReleased(
        uint256 indexed projectId,
        uint256 indexed milestoneId,
        address indexed freelancer,
        uint256 payout,
        uint256 fee
    );
    event WorkProofMinted(uint256 indexed projectId, address indexed freelancer, uint256 totalAmount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _usdc) {
        require(_usdc != address(0), "Invalid USDC");
        usdc = IERC20Like(_usdc);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function createProject(
        address client,
        string calldata title,
        string calldata description,
        string[] calldata milestoneTitles,
        uint256[] calldata milestoneAmounts
    ) external returns (uint256) {
        require(client != address(0), "Invalid client");
        require(client != msg.sender, "Client is freelancer");
        require(milestoneTitles.length > 0, "No milestones");
        require(milestoneTitles.length == milestoneAmounts.length, "Length mismatch");
        require(milestoneTitles.length <= 10, "Too many milestones");

        uint256 projectId = projectCounter++;
        uint256 totalAmount;

        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            require(milestoneAmounts[i] > 0, "Invalid milestone amount");
            totalAmount += milestoneAmounts[i];

            milestones[projectId][i] = Milestone({
                id: i,
                projectId: projectId,
                amount: milestoneAmounts[i],
                submittedAt: 0,
                releasedAt: 0,
                title: milestoneTitles[i],
                deliverableURI: "",
                status: MilestoneStatus.Created
            });
        }

        projects[projectId] = Project({
            id: projectId,
            freelancer: msg.sender,
            client: client,
            totalAmount: totalAmount,
            releasedAmount: 0,
            createdAt: block.timestamp,
            milestoneCount: milestoneAmounts.length,
            title: title,
            description: description,
            status: ProjectStatus.Created
        });

        userProjects[msg.sender].push(projectId);
        userProjects[client].push(projectId);

        emit ProjectCreated(projectId, msg.sender, client, totalAmount);
        return projectId;
    }

    function fundProject(uint256 projectId) external {
        Project storage project = projects[projectId];
        require(project.freelancer != address(0), "Project not found");
        require(msg.sender == project.client, "Not client");
        require(project.status == ProjectStatus.Created, "Not fundable");

        require(usdc.transferFrom(msg.sender, address(this), project.totalAmount), "USDC transfer failed");

        project.status = ProjectStatus.Funded;

        for (uint256 i = 0; i < project.milestoneCount; i++) {
            milestones[projectId][i].status = MilestoneStatus.Funded;
        }

        emit ProjectFunded(projectId, msg.sender, project.totalAmount);
    }

    function submitMilestone(
        uint256 projectId,
        uint256 milestoneId,
        string calldata deliverableURI
    ) external {
        Project storage project = projects[projectId];
        Milestone storage milestone = milestones[projectId][milestoneId];

        require(project.freelancer != address(0), "Project not found");
        require(msg.sender == project.freelancer, "Not freelancer");
        require(project.status == ProjectStatus.Funded, "Project not funded");
        require(milestone.id == milestoneId, "Milestone not found");
        require(milestone.status == MilestoneStatus.Funded, "Not submittable");

        milestone.status = MilestoneStatus.Submitted;
        milestone.deliverableURI = deliverableURI;
        milestone.submittedAt = block.timestamp;

        emit MilestoneSubmitted(projectId, milestoneId, deliverableURI);
    }

    function approveMilestone(uint256 projectId, uint256 milestoneId) external {
        Project storage project = projects[projectId];
        Milestone storage milestone = milestones[projectId][milestoneId];

        require(project.freelancer != address(0), "Project not found");
        require(msg.sender == project.client, "Not client");
        require(project.status == ProjectStatus.Funded, "Project not funded");
        require(milestone.id == milestoneId, "Milestone not found");
        require(milestone.status == MilestoneStatus.Submitted, "Not submitted");

        uint256 fee = (milestone.amount * platformFeeBps) / BPS_DENOMINATOR;
        uint256 payout = milestone.amount - fee;

        milestone.status = MilestoneStatus.Released;
        milestone.releasedAt = block.timestamp;
        project.releasedAmount += milestone.amount;

        require(usdc.transfer(project.freelancer, payout), "Payout failed");
        if (fee > 0) {
            require(usdc.transfer(owner, fee), "Fee transfer failed");
        }

        emit MilestoneReleased(projectId, milestoneId, project.freelancer, payout, fee);

        if (project.releasedAmount == project.totalAmount) {
            project.status = ProjectStatus.Completed;
            emit WorkProofMinted(projectId, project.freelancer, project.totalAmount);
        }
    }

    function cancelProject(uint256 projectId) external {
        Project storage project = projects[projectId];
        require(project.freelancer != address(0), "Project not found");
        require(
            msg.sender == project.freelancer || msg.sender == project.client,
            "Not participant"
        );
        require(project.status == ProjectStatus.Created, "Already funded");

        project.status = ProjectStatus.Cancelled;
        emit ProjectCancelled(projectId);
    }

    function getUserProjects(address user) external view returns (uint256[] memory) {
        return userProjects[user];
    }

    function setPlatformFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_PLATFORM_FEE_BPS, "Fee too high");
        platformFeeBps = _feeBps;
        emit PlatformFeeUpdated(_feeBps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
