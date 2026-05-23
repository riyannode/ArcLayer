// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";
import "../src/JobEscrow.sol";
import "../src/ReputationOracle.sol";
import "../src/WorkProof.sol";

contract MockUSDCV2 {
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

contract JobEscrowTest is Test {
    MockUSDCV2 private usdc;
    AgentRegistry private registry;
    WorkProof private workProof;
    JobEscrow private escrow;
    ReputationOracle private oracle;

    address private deployer = address(0xA11CE);
    address private client = address(0xC1);
    address private worker = address(0xD2);
    address private evaluator = address(0xE3);

    function setUp() public {
        vm.startPrank(deployer);
        usdc = new MockUSDCV2();
        registry = new AgentRegistry();
        workProof = new WorkProof();
        escrow = new JobEscrow(address(usdc), address(registry), address(workProof));
        oracle = new ReputationOracle(address(registry), address(workProof));
        workProof.setMinter(address(escrow));
        vm.stopPrank();

        usdc.mint(client, 1_000e6);

        vm.prank(worker);
        registry.registerAgent(1, keccak256("solidity-agent"), "ipfs://agent");
    }

    function testCreateFundSettleJobMintsWorkProof() public {
        vm.prank(client);
        uint256 jobId = escrow.createJob(1, worker, evaluator, keccak256("job-spec"));

        vm.prank(client);
        escrow.setBudget(jobId, 500e6);

        vm.prank(client);
        usdc.approve(address(escrow), 500e6);

        vm.prank(client);
        escrow.fund(jobId, 500e6);

        vm.prank(worker);
        escrow.submitDeliverable(jobId, "ipfs://deliverable", "ipfs://proof");

        vm.prank(evaluator);
        escrow.evaluate(jobId, true);

        vm.prank(client);
        escrow.settle(jobId);

        assertEq(usdc.balanceOf(worker), 497_500_000);
        assertEq(usdc.balanceOf(deployer), 2_500_000);
        assertEq(workProof.proofTokenByJobId(jobId), 1);

        uint256 score = oracle.getScore(1);
        assertGt(score, 0);
    }
}
