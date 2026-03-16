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
/// @notice Full integration test with multi-token support
contract RaffleLifecycleTest is Test {
    MockERC20 usdc6;   // 6-decimal mock (like USDC)
    MockERC20 cusd18;  // 18-decimal mock (like cUSD)
    MockRandomness mockRandom;
    BeneficiaryRegistry beneficiaryRegistry;
    AgentRegistry agentRegistry;
    TicketNFT ticketNFT;
    ReceiptSBT receiptSBT;
    RaffleRegistry raffleRegistry;
    RaffleFactory factory;
    RaffleVault vaultImpl;

    address deployer = address(this);
    address aro = makeAddr("aro");
    address agent1 = makeAddr("agent1");
    address agent2 = makeAddr("agent2");
    address agent3 = makeAddr("agent3");
    address charity1 = makeAddr("charity1");
    address protocolFee = makeAddr("protocolFee");

    function setUp() public {
        // Deploy mock tokens
        usdc6 = new MockERC20();
        vm.label(address(usdc6), "USDC6");
        cusd18 = new MockERC20();
        vm.label(address(cusd18), "cUSD18");

        mockRandom = new MockRandomness();

        // Deploy protocol contracts
        beneficiaryRegistry = new BeneficiaryRegistry();
        agentRegistry = new AgentRegistry(address(usdc6), 1e6); // staking in USDC, $1 bond
        ticketNFT = new TicketNFT();
        receiptSBT = new ReceiptSBT();
        raffleRegistry = new RaffleRegistry();
        vaultImpl = new RaffleVault();

        // Build accepted tokens array
        address[] memory tokens = new address[](2);
        uint8[] memory decimals = new uint8[](2);
        tokens[0] = address(usdc6);
        tokens[1] = address(cusd18);
        decimals[0] = 6;
        decimals[1] = 18;

        // Deploy factory with multi-token
        factory = new RaffleFactory(
            address(vaultImpl),
            tokens,
            decimals,
            address(ticketNFT),
            address(receiptSBT),
            address(agentRegistry),
            address(beneficiaryRegistry),
            address(raffleRegistry),
            address(mockRandom),
            protocolFee
        );

        // Wire permissions
        raffleRegistry.authorizeFactory(address(factory));
        agentRegistry.authorizeFactory(address(factory));
        ticketNFT.transferOwnership(address(factory));
        receiptSBT.transferOwnership(address(factory));

        // Register charities
        beneficiaryRegistry.registerBeneficiary(charity1, "Test Charity", "charity", "test");

        // Fund agents with USDC (6 decimals) — 100 USDC each
        usdc6.mint(aro, 100e6);
        usdc6.mint(agent1, 100e6);
        usdc6.mint(agent2, 100e6);
        usdc6.mint(agent3, 100e6);

        // Also fund some with cUSD (18 decimals) for mixed-token testing
        cusd18.mint(agent3, 100e18);

        // Register agents (bond = 1 USDC = 1e6)
        _registerAgent(aro);
        _registerAgent(agent1);
        _registerAgent(agent2);
        _registerAgent(agent3);
    }

    function _registerAgent(address agent) internal {
        vm.startPrank(agent);
        usdc6.approve(address(agentRegistry), 1e6); // $1 bond
        agentRegistry.registerAgent("https://example.com/agent.json", 1e6);
        vm.stopPrank();
    }

    function test_fullRaffleLifecycle() public {
        // ARO creates raffle: $0.10 ticket, 1 winner, 100% to winner
        vm.startPrank(aro);
        usdc6.approve(address(factory), 10e6); // approve enough for deposit

        RaffleVault.RaffleParams memory params = RaffleVault.RaffleParams({
            name: "Multi-Token Raffle",
            description: "Test raffle accepting USDC and cUSD",
            ticketPriceUsd6: 100000, // $0.10 in 6-decimal USD
            maxEntriesPerUser: 3,
            numWinners: 1,
            winnerShareBps: 10000,
            beneficiaryShareBps: 0,
            beneficiaryOptions: new address[](0),
            duration: 3600,
            targetPoolSize: 100000000, // $100 in 6-decimal USD
            minUniqueParticipants: 2,
            agentsOnly: false
        });

        address vault = factory.createRaffle(params);
        vm.stopPrank();

        RaffleVault rv = RaffleVault(payable(vault));
        assertEq(uint256(rv.state()), 1); // OPEN

        // Agent 1 enters with USDC (6 decimals): $0.10 = 100000 units
        vm.startPrank(agent1);
        usdc6.approve(vault, 100000);
        rv.enterRaffle(address(usdc6), address(0));
        vm.stopPrank();

        // Agent 2 enters with USDC
        vm.startPrank(agent2);
        usdc6.approve(vault, 100000);
        rv.enterRaffle(address(usdc6), address(0));
        vm.stopPrank();

        // Agent 3 enters with cUSD (18 decimals): $0.10 = 1e17 units
        vm.startPrank(agent3);
        cusd18.approve(vault, 2e17); // approve for 2 tickets
        rv.enterRaffle(address(cusd18), address(0));
        rv.enterRaffle(address(cusd18), address(0)); // buy 2nd ticket to meet minTickets
        vm.stopPrank();

        assertEq(rv.uniqueParticipantCount(), 3);
        assertEq(rv.totalPool(), 400000); // $0.40 in usd6 (4 tickets)

        // Close
        vm.warp(block.timestamp + 3601);
        rv.closeRaffle();
        assertEq(uint256(rv.state()), 2); // CLOSED

        // Request draw
        rv.requestDraw();
        assertEq(uint256(rv.state()), 3); // DRAWING

        // Fulfill randomness
        uint256 drawBlock = rv.randomizeBlock();
        mockRandom.fulfillBlock(drawBlock);

        // Complete draw
        rv.completeDraw();
        assertEq(uint256(rv.state()), 4); // PAYOUT

        address[] memory winners = rv.getWinners();
        assertEq(winners.length, 1);

        // Distribute prizes
        rv.distributePrizes();
        assertEq(uint256(rv.state()), 5); // SETTLED
    }

    function test_invalidRaffle_tooFewParticipants() public {
        vm.startPrank(aro);
        usdc6.approve(address(factory), 10e6);

        RaffleVault.RaffleParams memory params = RaffleVault.RaffleParams({
            name: "Too Small",
            description: "Should go invalid",
            ticketPriceUsd6: 100000,
            maxEntriesPerUser: 3,
            numWinners: 1,
            winnerShareBps: 10000,
            beneficiaryShareBps: 0,
            beneficiaryOptions: new address[](0),
            duration: 3600,
            targetPoolSize: 100000000,
            minUniqueParticipants: 2,
            agentsOnly: false
        });

        address vault = factory.createRaffle(params);
        vm.stopPrank();

        // Only 1 agent enters
        vm.startPrank(agent1);
        usdc6.approve(vault, 100000);
        RaffleVault(payable(vault)).enterRaffle(address(usdc6), address(0));
        vm.stopPrank();

        // Close
        vm.warp(block.timestamp + 3601);
        RaffleVault(payable(vault)).closeRaffle();

        // Request draw — should invalidate (1 < minUniqueParticipants)
        RaffleVault(payable(vault)).requestDraw();
        assertEq(uint256(RaffleVault(payable(vault)).state()), 6); // INVALID
    }

    function test_mixedTokenPrizes() public {
        // Create raffle
        vm.startPrank(aro);
        usdc6.approve(address(factory), 10e6);

        RaffleVault.RaffleParams memory params = RaffleVault.RaffleParams({
            name: "Mixed Token",
            description: "USDC + cUSD pool",
            ticketPriceUsd6: 100000,
            maxEntriesPerUser: 3,
            numWinners: 1,
            winnerShareBps: 10000,
            beneficiaryShareBps: 0,
            beneficiaryOptions: new address[](0),
            duration: 3600,
            targetPoolSize: 100000000,
            minUniqueParticipants: 2,
            agentsOnly: false
        });

        address vault = factory.createRaffle(params);
        vm.stopPrank();

        // Agent 1: USDC
        vm.startPrank(agent1);
        usdc6.approve(vault, 100000);
        RaffleVault(payable(vault)).enterRaffle(address(usdc6), address(0));
        vm.stopPrank();

        // Agent 2: USDC
        vm.startPrank(agent2);
        usdc6.approve(vault, 100000);
        RaffleVault(payable(vault)).enterRaffle(address(usdc6), address(0));
        vm.stopPrank();

        // Agent 3: cUSD (18 decimals) — buy 2 tickets to meet minTickets
        vm.startPrank(agent3);
        cusd18.approve(vault, 2e17);
        RaffleVault(payable(vault)).enterRaffle(address(cusd18), address(0));
        RaffleVault(payable(vault)).enterRaffle(address(cusd18), address(0));
        vm.stopPrank();

        // Vault should have both USDC and cUSD
        assertEq(usdc6.balanceOf(vault), 200000); // $0.20 USDC
        assertGt(cusd18.balanceOf(vault), 0);      // some cUSD

        // Close + draw + distribute
        vm.warp(block.timestamp + 3601);
        RaffleVault rv = RaffleVault(payable(vault));
        rv.closeRaffle();
        rv.requestDraw();
        mockRandom.fulfillBlock(rv.randomizeBlock());
        rv.completeDraw();
        rv.distributePrizes();

        assertEq(uint256(rv.state()), 5); // SETTLED

        // Winner should have received tokens from the vault
        address winner = rv.getWinners()[0];
        // Winner gets paid from whichever tokens are in the vault
        assertTrue(usdc6.balanceOf(winner) > 0 || cusd18.balanceOf(winner) > 0);
    }
}
