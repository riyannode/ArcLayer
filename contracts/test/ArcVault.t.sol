// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ArcVault.sol";

contract MockUSDC {
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

contract ArcVaultTest is Test {
    MockUSDC private usdc;
    ArcVault private vault;

    address private owner = address(0xA11CE);
    address private client = address(0xC);
    address private jobber = address(0xF);

    function setUp() public {
        vm.prank(owner);
        usdc = new MockUSDC();

        vm.prank(owner);
        vault = new ArcVault(address(usdc), address(0), owner);

        usdc.mint(client, 1_000e6);
    }

    function testCreateJobStoresMilestones() public {
        vm.startPrank(client);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 300e6;
        amounts[1] = 700e6;

        uint256[] memory deadlines = new uint256[](2);
        deadlines[0] = block.timestamp + 1 days;
        deadlines[1] = block.timestamp + 2 days;

        uint256 jobId = vault.createJob(1_000e6, keccak256("spec"), amounts, deadlines, block.timestamp + 3 days);
        vm.stopPrank();

        (
            ,
            address storedClient,
            ,
            uint256 totalAmount,
            ,
            ,
            uint256 milestoneCount,
            ,
            ,
            ArcVault.JobStatus status,
            ,

        ) = vault.jobs(jobId);

        assertEq(storedClient, client);
        assertEq(totalAmount, 1_000e6);
        assertEq(milestoneCount, 2);
        assertEq(uint256(status), uint256(ArcVault.JobStatus.OpenPool));

        (uint256 milestoneAmount,,,,,,) = vault.milestones(jobId, 0);
        assertEq(milestoneAmount, 300e6);
    }

    function testSubmitAndApproveMilestoneReleasesPayoutAndFee() public {
        uint256 jobId = _createOneMilestoneJob(500e6);

        vm.prank(jobber);
        vault.acceptJob(jobId, 0, 0);

        vm.prank(jobber);
        vault.submitMilestone(jobId, 0, "ipfs://delivery");

        vm.prank(client);
        vault.approveMilestone(jobId, 0);

        assertEq(usdc.balanceOf(jobber), 497_500_000);
        assertEq(usdc.balanceOf(owner), 2_500_000);

        (
            ,
            ,
            ,
            ,
            ,
            uint256 releasedAmount,
            ,
            ,
            ,
            ArcVault.JobStatus status,
            ,

        ) = vault.jobs(jobId);

        assertEq(releasedAmount, 497_500_000);
        assertEq(uint256(status), uint256(ArcVault.JobStatus.Completed));
    }

    function _createOneMilestoneJob(uint256 amount) private returns (uint256) {
        vm.startPrank(client);
        usdc.approve(address(vault), amount);
        vault.deposit(amount);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        uint256[] memory deadlines = new uint256[](1);
        deadlines[0] = block.timestamp + 1 days;

        uint256 jobId = vault.createJob(
            amount,
            keccak256("spec"),
            amounts,
            deadlines,
            block.timestamp + 2 days
        );
        vm.stopPrank();

        return jobId;
    }
}
