// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/MilestoneEscrow.sol";

contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MilestoneEscrowTest is Test {
    MockUSDC private usdc;
    MilestoneEscrow private escrow;

    address private owner = address(0xA11CE);
    address private freelancer = address(0xF);
    address private client = address(0xC);

    function setUp() public {
        vm.prank(owner);
        usdc = new MockUSDC();

        vm.prank(owner);
        escrow = new MilestoneEscrow(address(usdc));

        usdc.mint(client, 1_000e6);
    }

    function testCreateProjectStoresMilestones() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 300e6;
        amounts[1] = 700e6;

        string[] memory titles = new string[](2);
        titles[0] = "Wireframe";
        titles[1] = "Final delivery";

        vm.prank(freelancer);
        uint256 projectId = escrow.createProject(
            client,
            "Landing page redesign",
            "Design and ship a new landing page",
            titles,
            amounts
        );

        (
            ,
            address storedFreelancer,
            address storedClient,
            uint256 totalAmount,
            ,
            ,
            uint256 milestoneCount,
            ,
            ,
        ) = escrow.projects(projectId);

        assertEq(storedFreelancer, freelancer);
        assertEq(storedClient, client);
        assertEq(totalAmount, 1_000e6);
        assertEq(milestoneCount, 2);

        (, , uint256 milestoneAmount, , , string memory milestoneTitle, ,) = escrow.milestones(projectId, 0);
        assertEq(milestoneAmount, 300e6);
        assertEq(milestoneTitle, "Wireframe");
    }

    function testClientFundsEscrow() public {
        uint256 projectId = _createOneMilestoneProject(500e6);

        vm.prank(client);
        usdc.approve(address(escrow), 500e6);

        vm.prank(client);
        escrow.fundProject(projectId);

        assertEq(usdc.balanceOf(address(escrow)), 500e6);

        (, , , , , , , , , MilestoneEscrow.ProjectStatus status) = escrow.projects(projectId);
        assertEq(uint256(status), uint256(MilestoneEscrow.ProjectStatus.Funded));
    }

    function testSubmitAndApproveMilestoneReleasesPayoutAndFee() public {
        uint256 projectId = _createOneMilestoneProject(500e6);

        vm.prank(client);
        usdc.approve(address(escrow), 500e6);

        vm.prank(client);
        escrow.fundProject(projectId);

        vm.prank(freelancer);
        escrow.submitMilestone(projectId, 0, "ipfs://delivery");

        vm.prank(client);
        escrow.approveMilestone(projectId, 0);

        assertEq(usdc.balanceOf(freelancer), 497_500_000);
        assertEq(usdc.balanceOf(owner), 2_500_000);
        assertEq(usdc.balanceOf(address(escrow)), 0);

        (, , , , uint256 releasedAmount, , , , , MilestoneEscrow.ProjectStatus status) = escrow.projects(projectId);
        assertEq(releasedAmount, 500e6);
        assertEq(uint256(status), uint256(MilestoneEscrow.ProjectStatus.Completed));
    }

    function testOnlyClientCanFund() public {
        uint256 projectId = _createOneMilestoneProject(500e6);

        vm.prank(freelancer);
        vm.expectRevert("Not client");
        escrow.fundProject(projectId);
    }

    function testOnlyFreelancerCanSubmit() public {
        uint256 projectId = _createOneMilestoneProject(500e6);

        vm.prank(client);
        usdc.approve(address(escrow), 500e6);

        vm.prank(client);
        escrow.fundProject(projectId);

        vm.prank(client);
        vm.expectRevert("Not freelancer");
        escrow.submitMilestone(projectId, 0, "ipfs://delivery");
    }

    function _createOneMilestoneProject(uint256 amount) private returns (uint256) {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        string[] memory titles = new string[](1);
        titles[0] = "Milestone 1";

        vm.prank(freelancer);
        return escrow.createProject(
            client,
            "Brand system",
            "Design system delivery",
            titles,
            amounts
        );
    }
}
