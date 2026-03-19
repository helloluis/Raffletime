// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RaffleFactory.sol";
import "../src/RaffleVault.sol";
import "../src/RaffleRegistry.sol";
import "../src/AgentRegistry.sol";
import "../src/BeneficiaryRegistry.sol";
import "../src/TicketNFT.sol";
import "../src/ReceiptSBT.sol";
import "../src/VRFDispatcher.sol";

/// @title DeployBaseMainnet
/// @notice Deploys the full RaffleTime protocol to Base mainnet.
///         Uses Circle USDC on Base as the primary payment token.
///         Uses real Chainlink VRF v2.5 with funded subscription.
///
/// IMPORTANT: After deployment, add the VRFDispatcher address as a consumer
///            on your subscription at vrf.chain.link.
///
/// Usage:
///   PRIVATE_KEY=0x... forge script script/DeployBaseMainnet.s.sol:DeployBaseMainnet \
///     --rpc-url https://mainnet.base.org \
///     --broadcast -vvvv
///
/// Required env vars:
///   PRIVATE_KEY — deployer wallet (also becomes protocol fee recipient)
///   VRF_SUBSCRIPTION_ID — Chainlink VRF subscription ID (create at vrf.chain.link)
contract DeployBaseMainnet is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        uint256 vrfSubscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID");
        address protocolFeeRecipient = vm.envAddress("PROTOCOL_FEE_RECIPIENT");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Protocol Fee Recipient:", protocolFeeRecipient);
        console.log("Chain: Base Mainnet (8453)");
        console.log("VRF Subscription:", vrfSubscriptionId);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Payment tokens — USDC + USDT on Base mainnet
        address usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Circle USDC on Base
        address usdt = 0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2; // Tether USDT on Base

        address[] memory tokens = new address[](2);
        uint8[] memory decimals = new uint8[](2);
        tokens[0] = usdc;
        decimals[0] = 6;
        tokens[1] = usdt;
        decimals[1] = 6;

        // 2. Deploy standalone contracts
        BeneficiaryRegistry beneficiaryRegistry = new BeneficiaryRegistry();
        console.log("BeneficiaryRegistry:", address(beneficiaryRegistry));

        AgentRegistry agentRegistry = new AgentRegistry(usdc, 1e6); // $1 USDC bond
        console.log("AgentRegistry:", address(agentRegistry));

        TicketNFT ticketNFT = new TicketNFT();
        console.log("TicketNFT:", address(ticketNFT));

        ReceiptSBT receiptSBT = new ReceiptSBT();
        console.log("ReceiptSBT:", address(receiptSBT));

        RaffleRegistry raffleRegistry = new RaffleRegistry();
        console.log("RaffleRegistry:", address(raffleRegistry));

        // 3. Deploy VRFDispatcher with Chainlink VRF v2.5 on Base mainnet
        //    Docs: https://docs.chain.link/vrf/v2-5/supported-networks#base-mainnet
        address vrfCoordinator = 0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634;
        bytes32 keyHash = 0x89630569c9567e43c9B4f636caFb6BCA1E267033f0dBa0bb1e04575AeA7e1302; // 500 gwei lane
        uint32 callbackGasLimit = 500000;

        VRFDispatcher vrfDispatcher = new VRFDispatcher(
            vrfCoordinator,
            vrfSubscriptionId,
            keyHash,
            callbackGasLimit,
            deployer // temporary factory; updated below
        );
        console.log("VRFDispatcher:", address(vrfDispatcher));

        // 4. Deploy vault implementation
        RaffleVault vaultImpl = new RaffleVault();
        console.log("RaffleVault (impl):", address(vaultImpl));

        // 5. Deploy factory
        RaffleFactory factory = new RaffleFactory(
            address(vaultImpl),
            tokens,
            decimals,
            address(ticketNFT),
            address(receiptSBT),
            address(agentRegistry),
            address(beneficiaryRegistry),
            address(raffleRegistry),
            address(vrfDispatcher),
            protocolFeeRecipient
        );
        console.log("RaffleFactory:", address(factory));
        console.log("Protocol fee recipient:", protocolFeeRecipient);

        // 6. Wire up permissions
        raffleRegistry.authorizeFactory(address(factory));
        agentRegistry.authorizeFactory(address(factory));
        ticketNFT.transferOwnership(address(factory));
        receiptSBT.transferOwnership(address(factory));
        vrfDispatcher.setFactory(address(factory));

        // 7. Register deployer as beneficiary
        beneficiaryRegistry.registerBeneficiary(
            deployer,
            "RaffleTime",
            "platform",
            "RaffleTime House Agent"
        );
        console.log("Registered deployer as beneficiary");

        vm.stopBroadcast();

        // Print summary for copy-paste into .env files
        console.log("\n========== Copy to packages/agent/.env.mainnet ==========");
        console.log("CHAIN_ID=8453");
        console.log("RPC_URL=https://mainnet.base.org");
        console.log("FACTORY_ADDRESS=%s", vm.toString(address(factory)));
        console.log("REGISTRY_ADDRESS=%s", vm.toString(address(raffleRegistry)));
        console.log("AGENT_REGISTRY_ADDRESS=%s", vm.toString(address(agentRegistry)));
        console.log("PAYMENT_TOKEN_ADDRESS=%s", vm.toString(usdc));
        console.log("VRF_DISPATCHER_ADDRESS=%s", vm.toString(address(vrfDispatcher)));
        console.log("========================================================");
        console.log("\n*** IMPORTANT: Add VRFDispatcher as a consumer on your subscription ***");
        console.log("*** Go to vrf.chain.link > your subscription > Add Consumer ***");
        console.log("*** Consumer address: %s ***", vm.toString(address(vrfDispatcher)));
    }
}