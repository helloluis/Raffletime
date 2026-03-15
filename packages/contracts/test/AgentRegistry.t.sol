// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";
import "../src/mocks/MockERC20.sol";

contract AgentRegistryTest is Test {
    AgentRegistry registry;
    MockERC20 cUSD;

    address agent1 = makeAddr("agent1");
    address agent2 = makeAddr("agent2");

    function setUp() public {
        cUSD = new MockERC20();
        registry = new AgentRegistry(address(cUSD));

        // Fund agents for bond
        cUSD.mint(agent1, 100e18);
        cUSD.mint(agent2, 100e18);
    }

    function test_registerAgent() public {
        vm.startPrank(agent1);
        cUSD.approve(address(registry), 1e18);
        uint256 id = registry.registerAgent("https://example.com/agent.json", 1e18);
        vm.stopPrank();

        assertEq(id, 1);
        assertTrue(registry.isRegistered(agent1));
        assertEq(registry.getAgentIdByAddress(agent1), 1);
        assertEq(registry.totalAgents(), 1);
        assertTrue(registry.hasActiveBond(agent1));
    }

    function test_cannotRegisterTwice() public {
        vm.startPrank(agent1);
        cUSD.approve(address(registry), 2e18);
        registry.registerAgent("https://example.com/agent.json", 1e18);

        vm.expectRevert("Already registered");
        registry.registerAgent("https://example.com/agent2.json", 1e18);
        vm.stopPrank();
    }

    function test_bondBelowMinimumReverts() public {
        vm.startPrank(agent1);
        cUSD.approve(address(registry), 1e18);
        vm.expectRevert("Bond below minimum");
        registry.registerAgent("https://example.com/agent.json", 0.5e18);
        vm.stopPrank();
    }

    // ============ Admission Bond Tests ============

    function test_bondWithdrawalCooldown() public {
        // Register with bond
        vm.startPrank(agent1);
        cUSD.approve(address(registry), 2e18);
        registry.registerAgent("https://example.com/agent.json", 2e18);

        // Request withdrawal
        registry.requestBondWithdrawal();
        assertTrue(registry.hasActiveBond(agent1) == false); // pending withdrawal = not active

        // Try to complete before cooldown — should fail
        vm.expectRevert("Cooldown not elapsed");
        registry.completeBondWithdrawal();

        // Warp past cooldown
        vm.warp(block.timestamp + 14 days + 1);

        uint256 balBefore = cUSD.balanceOf(agent1);
        registry.completeBondWithdrawal();
        assertEq(cUSD.balanceOf(agent1) - balBefore, 2e18);
        assertFalse(registry.hasActiveBond(agent1));
        vm.stopPrank();
    }

    function test_cancelBondWithdrawal() public {
        vm.startPrank(agent1);
        cUSD.approve(address(registry), 1e18);
        registry.registerAgent("https://example.com/agent.json", 1e18);

        registry.requestBondWithdrawal();
        assertFalse(registry.hasActiveBond(agent1));

        registry.cancelBondWithdrawal();
        assertTrue(registry.hasActiveBond(agent1));
        vm.stopPrank();
    }

    function test_depositAdditionalBond() public {
        vm.startPrank(agent1);
        cUSD.approve(address(registry), 5e18);
        registry.registerAgent("https://example.com/agent.json", 1e18);

        registry.depositBond(2e18);

        // Withdraw all — should get 3e18 back
        registry.requestBondWithdrawal();
        vm.warp(block.timestamp + 14 days + 1);
        uint256 balBefore = cUSD.balanceOf(agent1);
        registry.completeBondWithdrawal();
        assertEq(cUSD.balanceOf(agent1) - balBefore, 3e18);
        vm.stopPrank();
    }

    function test_slashBond() public {
        vm.startPrank(agent1);
        cUSD.approve(address(registry), 5e18);
        registry.registerAgent("https://example.com/agent.json", 5e18);
        vm.stopPrank();

        // Owner slashes
        address owner = registry.owner();
        uint256 ownerBalBefore = cUSD.balanceOf(owner);
        registry.slashBond(1, "Sybil attack");

        // Bond goes to owner
        assertEq(cUSD.balanceOf(owner) - ownerBalBefore, 5e18);
        // Agent is suspended and has no bond
        assertFalse(registry.hasActiveBond(agent1));
        assertTrue(registry.isSuspended(agent1));
    }

    function test_rebondAfterWithdrawal() public {
        vm.startPrank(agent1);
        cUSD.approve(address(registry), 10e18);
        registry.registerAgent("https://example.com/agent.json", 1e18);

        // Withdraw
        registry.requestBondWithdrawal();
        vm.warp(block.timestamp + 14 days + 1);
        registry.completeBondWithdrawal();
        assertFalse(registry.hasActiveBond(agent1));

        // Re-bond
        registry.depositBond(2e18);
        assertTrue(registry.hasActiveBond(agent1));
        vm.stopPrank();
    }

    // ============ Stake Calculation Tests ============

    function test_stakeCalculation_smallPool() public pure {
        // $10 pool → stake ≈ $0.03
        uint256 stake = _calculateStake(10e18, 0);
        assertGe(stake, 0.01e18); // at least MIN_STAKE
        assertLe(stake, 0.05e18);
    }

    function test_stakeCalculation_referencePool() public pure {
        // $100 pool → stake = $0.10
        uint256 stake = _calculateStake(100e18, 0);
        assertEq(stake, 0.1e18);
    }

    function test_stakeCalculation_largePool() public pure {
        // $10,000 pool → stake = $1.00
        uint256 stake = _calculateStake(10000e18, 0);
        assertEq(stake, 1e18);
    }

    function test_stakeCalculation_overflowBrackets() public pure {
        uint256 target = 1000e18;

        // At target: base stake
        uint256 baseStake = _calculateStake(target, target);

        // At 125% of target: should use 1.25x effective pool
        uint256 stake125 = _calculateStake(target, 1250e18);
        assertGt(stake125, baseStake);

        // At 150% of target: should use 1.5x effective pool
        uint256 stake150 = _calculateStake(target, 1500e18);
        assertGt(stake150, stake125);

        // At 200% of target: should use 2x effective pool
        uint256 stake200 = _calculateStake(target, 2000e18);
        assertGt(stake200, stake150);
    }

    function test_stakeCalculation_overflowBracketSteps() public pure {
        uint256 target = 100e18;

        // 101% and 125% should be in the same bracket (ceil to 125%)
        uint256 stake101 = _calculateStake(target, 101e18);
        uint256 stake125 = _calculateStake(target, 125e18);
        assertEq(stake101, stake125);

        // 126% and 150% should be in the same bracket (ceil to 150%)
        uint256 stake126 = _calculateStake(target, 126e18);
        uint256 stake150 = _calculateStake(target, 150e18);
        assertEq(stake126, stake150);
    }

    function testFuzz_stakeNeverBelowMinimum(uint256 targetPool, uint256 actualPool) public pure {
        targetPool = bound(targetPool, 0, 1_000_000e18);
        actualPool = bound(actualPool, 0, 2_000_000e18);

        uint256 stake = _calculateStake(targetPool, actualPool);
        assertGe(stake, 0.01e18); // MIN_STAKE
    }

    function testFuzz_stakeMonotonicallyIncreasesWithPool(uint256 smallPool, uint256 largePool) public pure {
        smallPool = bound(smallPool, 1e18, 500_000e18);
        largePool = bound(largePool, smallPool + 1, 1_000_000e18);

        uint256 stakeSmall = _calculateStake(smallPool, 0);
        uint256 stakeLarge = _calculateStake(largePool, 0);
        assertGe(stakeLarge, stakeSmall);
    }

    // Helper to call the pure function without needing the full contract
    function _calculateStake(uint256 targetPoolSize, uint256 actualPoolSize) internal pure returns (uint256) {
        // Replicate the AgentRegistry logic for testing
        uint256 effectivePool = targetPoolSize;

        if (actualPoolSize > targetPoolSize && targetPoolSize > 0) {
            uint256 overflow = actualPoolSize - targetPoolSize;
            uint256 bracketSize = targetPoolSize / 4;
            if (bracketSize == 0) bracketSize = 1;
            uint256 bracketIndex = (overflow + bracketSize - 1) / bracketSize;
            effectivePool = targetPoolSize + (targetPoolSize * bracketIndex) / 4;
        }

        if (effectivePool == 0) return 0.01e18;

        uint256 scaled = (effectivePool * 1e18) / 100e18; // REFERENCE_SIZE
        uint256 sqrtScaled = _sqrt(scaled);
        uint256 stake = (0.10e18 * sqrtScaled) / 1e9; // BASE_STAKE

        return stake > 0.01e18 ? stake : 0.01e18;
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
