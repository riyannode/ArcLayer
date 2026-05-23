// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ArcVault.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (msg.sender != from) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract ArcVaultTest is Test {
    ArcVault public vault;
    MockUSDC public usdc;
    address client = address(0x1);
    address jobber = address(0x2);
    address resolver = address(0x3);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new ArcVault(address(usdc), address(0), resolver);
        
        usdc.mint(client, 20000);
        usdc.mint(jobber, 10000);
        
        vm.startPrank(client);
        usdc.approve(address(vault), 20000);
        vault.deposit(10000);
        vm.stopPrank();
    }

    function _jobStatus(uint256 jobId) private view returns (ArcVault.JobStatus status) {
        (,,,,,,,,,, status,,) = vault.jobs(jobId);
    }

    function _jobClient(uint256 jobId) private view returns (address clientAddr) {
        (, clientAddr,,,,,,,,,,,) = vault.jobs(jobId);
    }

    function _jobJobber(uint256 jobId) private view returns (address jobberAddr) {
        (,, jobberAddr,,,,,,,,,,) = vault.jobs(jobId);
    }

    function _jobReleased(uint256 jobId) private view returns (uint256 released) {
        (,,,,, released,,,,,,,) = vault.jobs(jobId);
    }

    function testDeposit() public {
        assertEq(vault.openPoolBalance(client), 10000);
    }

    function testWithdraw() public {
        vm.prank(client);
        vault.withdraw(5000);
        assertEq(vault.openPoolBalance(client), 5000);
    }

    function testCreateJob() public {
        vm.startPrank(client);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000;
        uint256[] memory deadlines = new uint256[](1);
        deadlines[0] = block.timestamp + 1000;
        
        uint256 jobId = vault.createJob(1000, bytes32(0), amounts, deadlines, block.timestamp + 2000);
        vm.stopPrank();
        
        assertEq(vault.openPoolBalance(client), 9000);
        assertEq(jobId, 1);
        assertEq(_jobClient(jobId), client);
        assertEq(_jobJobber(jobId), address(0));
        assertTrue(_jobStatus(jobId) == ArcVault.JobStatus.OpenPool);
    }

    function testCancelOpenJob() public {
        vm.startPrank(client);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000;
        uint256[] memory deadlines = new uint256[](1);
        deadlines[0] = block.timestamp + 1000;
        uint256 jobId = vault.createJob(1000, bytes32(0), amounts, deadlines, block.timestamp + 2000);
        
        vault.cancelOpenJob(jobId);
        vm.stopPrank();

        assertEq(vault.openPoolBalance(client), 10000);
        assertTrue(_jobStatus(jobId) == ArcVault.JobStatus.Cancelled);
    }

    function testAcceptJob() public {
        vm.startPrank(client);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000;
        uint256[] memory deadlines = new uint256[](1);
        deadlines[0] = block.timestamp + 1000;
        uint256 jobId = vault.createJob(1000, bytes32(0), amounts, deadlines, block.timestamp + 2000);
        vm.stopPrank();

        vm.startPrank(jobber);
        vault.acceptJob(jobId, 0, 0);
        vm.stopPrank();

        assertEq(_jobJobber(jobId), jobber);
        assertTrue(_jobStatus(jobId) == ArcVault.JobStatus.Active);
    }

    function testSubmitAndApproveMilestone() public {
        vm.startPrank(client);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000;
        uint256[] memory deadlines = new uint256[](1);
        deadlines[0] = block.timestamp + 1000;
        uint256 jobId = vault.createJob(1000, bytes32(0), amounts, deadlines, block.timestamp + 2000);
        vm.stopPrank();

        vm.startPrank(jobber);
        vault.acceptJob(jobId, 0, 0);
        vault.submitMilestone(jobId, 0, "ipfs://proof");
        vm.stopPrank();

        ArcVault.Milestone memory m = vault.getMilestone(jobId, 0);
        assertTrue(m.status == ArcVault.MilestoneStatus.Submitted);

        vm.prank(client);
        vault.approveMilestone(jobId, 0);

        m = vault.getMilestone(jobId, 0);
        assertTrue(m.status == ArcVault.MilestoneStatus.Released);
        assertTrue(_jobStatus(jobId) == ArcVault.JobStatus.Completed);
        
        // Fee = 50 bps of 1000 = 5. Payout = 995.
        assertEq(_jobReleased(jobId), 995);
        assertEq(usdc.balanceOf(jobber), 10995);
    }
}
