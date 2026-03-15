// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RaffleFactory.sol";
import "../src/RaffleVault.sol";
import "../src/RaffleRegistry.sol";
import "../src/AgentRegistry.sol";
import "../src/BeneficiaryRegistry.sol";
import "../src/TicketNFT.sol";
import "../src/ReceiptSBT.sol";
import {MockRandomness} from "../src/mocks/MockRandomness.sol";
import "../src/mocks/MockERC20.sol";

/// @title RaffleLifecycleTest
/// @notice Full integration test: create raffle → enter as 3 agents → close → draw → payout → settle
contract RaffleLifecycleTest is Test {
    MockERC20 cUSD;
    MockRandomness anyrand;
    BeneficiaryRegistry beneficiaryRegistry;
    AgentRegistry agentRegistry;
    TicketNFT ticketNFT;
    ReceiptSBT receiptSBT;
    RaffleRegistry raffleRegistry;
    RaffleFactory factory;
    RaffleVault vaultImpl;

    address deployer = address(this);
    address aro = makeAddr("aro"); // Agent Raffle Operator
    address agent1 = makeAddr("agent1");
    address agent2 = makeAddr("agent2");
    address agent3 = makeAddr("agent3");
    address charity1 = makeAddr("charity1");
    address charity2 = makeAddr("charity2");
    address protocolFee = makeAddr("protocolFee");

    function setUp() public {
        // Deploy mocks
        cUSD = new MockERC20();
        anyrand = new MockRandomness();

        // Deploy protocol contracts
        beneficiaryRegistry = new BeneficiaryRegistry();
        agentRegistry = new AgentRegistry(address(cUSD));
        ticketNFT = new TicketNFT();
        receiptSBT = new ReceiptSBT();
        raffleRegistry = new RaffleRegistry();
        vaultImpl = new RaffleVault();

        // Deploy factory
        factory = new RaffleFactory(
            address(vaultImpl),
            address(cUSD),
            address(ticketNFT),
            address(receiptSBT),
            address(agentRegistry),
            address(beneficiaryRegistry),
            address(raffleRegistry),
            address(anyrand),
            protocolFee
        );

        // Authorize factory in registries
        raffleRegistry.authorizeFactory(address(factory));
        agentRegistry.authorizeFactory(address(factory));

        // Transfer ownership of ticketNFT and receiptSBT to factory
        ticketNFT.transferOwnership(address(factory));
        receiptSBT.transferOwnership(address(factory));

        // Register beneficiaries
        beneficiaryRegistry.registerBeneficiary(charity1, "UNICEF", "charity", "RaffleTime v1");
        beneficiaryRegistry.registerBeneficiary(charity2, "Red Cross", "charity", "RaffleTime v1");

        // Fund all agents with cUSD
        cUSD.mint(aro, 1000e18);
        cUSD.mint(agent1, 1000e18);
        cUSD.mint(agent2, 1000e18);
        cUSD.mint(agent3, 1000e18);

        // Register agents (with admission bond)
        _registerAgent(aro, "https://example.com/aro-agent.json");
        _registerAgent(agent1, "https://example.com/agent1.json");
        _registerAgent(agent2, "https://example.com/agent2.json");
        _registerAgent(agent3, "https://example.com/agent3.json");
    }

    function _registerAgent(address agent, string memory uri) internal {
        vm.startPrank(agent);
        cUSD.approve(address(agentRegistry), 1e18);
        agentRegistry.registerAgent(uri, 1e18);
        vm.stopPrank();
    }

    function test_fullRaffleLifecycle() public {
        // ============ Step 1: ARO creates raffle ============
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = charity1;
        beneficiaries[1] = charity2;

        RaffleVault.RaffleParams memory params = RaffleVault.RaffleParams({
            name: "Eyes on the Prize",
            description: "Hourly raffle",
            ticketPrice: 0.10e18, // $0.10
            maxEntriesPerUser: 1,
            numWinners: 1,
            winnerShareBps: 9000, // 90%
            beneficiaryShareBps: 1000, // 10%
            beneficiaryOptions: beneficiaries,
            duration: 3600, // 1 hour
            targetPoolSize: 100e18, // $100
            minUniqueParticipants: 2,
            agentsOnly: true
        });

        uint256 deposit = factory.calculateDeposit(params.targetPoolSize);

        vm.startPrank(aro);
        cUSD.approve(address(factory), deposit);
        address vault = factory.createRaffle(params);
        vm.stopPrank();

        // Verify raffle was created
        RaffleVault rv = RaffleVault(payable(vault));
        assertEq(uint256(rv.state()), uint256(RaffleVault.State.OPEN));
        assertEq(rv.creator(), aro);
        assertEq(raffleRegistry.getRaffleCount(), 1);

        // ============ Step 2: Agents enter raffle (direct entry) ============
        vm.startPrank(agent1);
        cUSD.approve(vault, 0.10e18);
        rv.enterRaffle(charity1);
        vm.stopPrank();

        vm.startPrank(agent2);
        cUSD.approve(vault, 0.10e18);
        rv.enterRaffle(charity2);
        vm.stopPrank();

        vm.startPrank(agent3);
        cUSD.approve(vault, 0.10e18);
        rv.enterRaffle(charity1);
        vm.stopPrank();

        assertEq(rv.totalPool(), 0.30e18);
        assertEq(rv.getParticipantCount(), 3);
        assertEq(rv.uniqueParticipantCount(), 3);

        // ============ Step 3: Close raffle after duration ============
        vm.warp(block.timestamp + 3601); // Fast forward past duration

        rv.closeRaffle();
        assertEq(uint256(rv.state()), uint256(RaffleVault.State.CLOSED));

        // ============ Step 4: Request draw (sends CELO for Witnet fee) ============
        rv.requestDraw{value: 0}(); // MockWitnet fee is 0
        assertEq(uint256(rv.state()), uint256(RaffleVault.State.DRAWING));

        // ============ Step 5: Witnet fulfills randomness, then complete draw ============
        uint256 drawBlock = rv.randomizeBlock();
        anyrand.fulfillBlock(drawBlock);
        rv.completeDraw();

        assertEq(uint256(rv.state()), uint256(RaffleVault.State.PAYOUT));
        assertEq(rv.getWinners().length, 1);

        // Charity1 should win the beneficiary vote (2 votes vs 1)
        assertEq(rv.winningBeneficiary(), charity1);

        // ============ Step 6: Distribute prizes ============
        address winner = rv.getWinners()[0];
        uint256 winnerBalanceBefore = cUSD.balanceOf(winner);
        uint256 charityBalanceBefore = cUSD.balanceOf(charity1);

        rv.distributePrizes();
        assertEq(uint256(rv.state()), uint256(RaffleVault.State.SETTLED));

        // Winner gets 90% of 0.30 = 0.27 cUSD
        assertEq(cUSD.balanceOf(winner) - winnerBalanceBefore, 0.27e18);
        // Charity1 gets 10% of 0.30 = 0.03 cUSD
        assertEq(cUSD.balanceOf(charity1) - charityBalanceBefore, 0.03e18);

        // Verify receipt SBT was minted
        assertEq(receiptSBT.totalReceipts(), 1);

        // ============ Step 7: ARO claims deposit (SETTLED = 80% refund) ============
        vm.startPrank(aro);
        uint256 aroBalanceBefore = cUSD.balanceOf(aro);
        uint256 protocolBalanceBefore = cUSD.balanceOf(protocolFee);
        factory.claimDeposit(vault);

        uint256 expectedAroRefund = (deposit * 8000) / 10000; // 80%
        uint256 expectedProtocolFee = deposit - expectedAroRefund; // 20%
        assertEq(cUSD.balanceOf(aro) - aroBalanceBefore, expectedAroRefund);
        assertEq(cUSD.balanceOf(protocolFee) - protocolBalanceBefore, expectedProtocolFee);
        vm.stopPrank();
    }

    function test_suspendedAgentCannotEnter() public {
        // Create raffle
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = charity1;

        RaffleVault.RaffleParams memory params = RaffleVault.RaffleParams({
            name: "Suspension Test",
            description: "Test",
            ticketPrice: 0.10e18,
            maxEntriesPerUser: 1,
            numWinners: 1,
            winnerShareBps: 9000,
            beneficiaryShareBps: 1000,
            beneficiaryOptions: beneficiaries,
            duration: 3600,
            targetPoolSize: 100e18,
            minUniqueParticipants: 2,
            agentsOnly: false
        });

        uint256 deposit2 = factory.calculateDeposit(params.targetPoolSize);
        vm.startPrank(aro);
        cUSD.approve(address(factory), deposit2);
        address vault = factory.createRaffle(params);
        vm.stopPrank();

        RaffleVault rv = RaffleVault(payable(vault));

        // Suspend agent1 (agentId=2, since aro is ID 1)
        uint256 agent1Id = agentRegistry.getAgentIdByAddress(agent1);
        agentRegistry.suspendAgent(agent1Id, "Sybil attack detected");
        assertTrue(agentRegistry.isSuspended(agent1));

        // Agent1 tries to enter — should revert
        vm.startPrank(agent1);
        cUSD.approve(vault, 0.10e18);
        vm.expectRevert("Agent suspended");
        rv.enterRaffle(charity1);
        vm.stopPrank();

        // Reinstate agent1
        agentRegistry.reinstateAgent(agent1Id);
        assertFalse(agentRegistry.isSuspended(agent1));

        // Now agent1 can enter
        vm.startPrank(agent1);
        rv.enterRaffle(charity1);
        vm.stopPrank();

        assertEq(rv.getParticipantCount(), 1);
    }

    function test_invalidRaffle_insufficientParticipants() public {
        // Create raffle with minUniqueParticipants = 3
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = charity1;

        RaffleVault.RaffleParams memory params = RaffleVault.RaffleParams({
            name: "Too Small Raffle",
            description: "Will fail",
            ticketPrice: 1e18,
            maxEntriesPerUser: 1,
            numWinners: 1,
            winnerShareBps: 9000,
            beneficiaryShareBps: 1000,
            beneficiaryOptions: beneficiaries,
            duration: 3600,
            targetPoolSize: 100e18,
            minUniqueParticipants: 3,
            agentsOnly: false
        });

        uint256 deposit3 = factory.calculateDeposit(params.targetPoolSize);
        vm.startPrank(aro);
        cUSD.approve(address(factory), deposit3);
        address vault = factory.createRaffle(params);
        vm.stopPrank();

        RaffleVault rv = RaffleVault(payable(vault));

        // Only 1 agent enters (direct entry)
        vm.startPrank(agent1);
        cUSD.approve(vault, 1e18);
        rv.enterRaffle(charity1);
        vm.stopPrank();

        assertEq(rv.getParticipantCount(), 1);
        assertEq(rv.uniqueParticipantCount(), 1);

        // Close
        vm.warp(block.timestamp + 3601);
        rv.closeRaffle();

        // Request draw — should invalidate (insufficient participants)
        rv.requestDraw{value: 0}();
        assertEq(uint256(rv.state()), uint256(RaffleVault.State.INVALID));

        // Agent claims refund
        uint256 balBefore = cUSD.balanceOf(agent1);
        vm.prank(agent1);
        rv.claimRefund();
        assertEq(cUSD.balanceOf(agent1) - balBefore, 1e18);

        // ARO claims deposit (INVALID = 50% refund)
        vm.startPrank(aro);
        uint256 aroBefore = cUSD.balanceOf(aro);
        uint256 protocolBefore = cUSD.balanceOf(protocolFee);
        factory.claimDeposit(vault);

        uint256 expectedRefund = (deposit3 * 5000) / 10000; // 50%
        uint256 expectedFee = deposit3 - expectedRefund; // 50%
        assertEq(cUSD.balanceOf(aro) - aroBefore, expectedRefund);
        assertEq(cUSD.balanceOf(protocolFee) - protocolBefore, expectedFee);
        vm.stopPrank();
    }

    function test_agentsOnly_blocksUnregistered() public {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = charity1;

        RaffleVault.RaffleParams memory params = RaffleVault.RaffleParams({
            name: "Agents Only Raffle",
            description: "Test",
            ticketPrice: 0.10e18,
            maxEntriesPerUser: 1,
            numWinners: 1,
            winnerShareBps: 9000,
            beneficiaryShareBps: 1000,
            beneficiaryOptions: beneficiaries,
            duration: 3600,
            targetPoolSize: 100e18,
            minUniqueParticipants: 2,
            agentsOnly: true
        });

        uint256 deposit = factory.calculateDeposit(params.targetPoolSize);
        vm.startPrank(aro);
        cUSD.approve(address(factory), deposit);
        address vault = factory.createRaffle(params);
        vm.stopPrank();

        RaffleVault rv = RaffleVault(payable(vault));

        // Unregistered address tries to enter — should revert
        address rando = makeAddr("rando");
        cUSD.mint(rando, 1e18);

        vm.startPrank(rando);
        cUSD.approve(vault, 0.10e18);
        vm.expectRevert("Agents only");
        rv.enterRaffle(charity1);
        vm.stopPrank();

        // Registered agent CAN enter
        vm.startPrank(agent1);
        cUSD.approve(vault, 0.10e18);
        rv.enterRaffle(charity1);
        vm.stopPrank();

        assertEq(rv.getParticipantCount(), 1);
    }

    function test_agentsOnly_requiresActiveBond() public {
        // Agent1 withdraws their bond FIRST (takes 14 days)
        vm.startPrank(agent1);
        agentRegistry.requestBondWithdrawal();
        vm.stopPrank();
        vm.warp(block.timestamp + 14 days + 1);
        vm.prank(agent1);
        agentRegistry.completeBondWithdrawal();

        // Now create raffle AFTER the time warp so it's still open
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = charity1;

        RaffleVault.RaffleParams memory params = RaffleVault.RaffleParams({
            name: "Bond Required Raffle",
            description: "Test",
            ticketPrice: 0.10e18,
            maxEntriesPerUser: 1,
            numWinners: 1,
            winnerShareBps: 9000,
            beneficiaryShareBps: 1000,
            beneficiaryOptions: beneficiaries,
            duration: 3600,
            targetPoolSize: 100e18,
            minUniqueParticipants: 2,
            agentsOnly: true
        });

        uint256 deposit = factory.calculateDeposit(params.targetPoolSize);
        vm.startPrank(aro);
        cUSD.approve(address(factory), deposit);
        address vault = factory.createRaffle(params);
        vm.stopPrank();

        RaffleVault rv = RaffleVault(payable(vault));

        // Agent1 tries to enter — should revert (no active bond)
        vm.startPrank(agent1);
        cUSD.approve(vault, 0.10e18);
        vm.expectRevert("Bond required");
        rv.enterRaffle(charity1);
        vm.stopPrank();
    }
}
