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
// MockERC20 not used in final deployment

/// @title DeployBase
/// @notice Deploys the full RaffleTime protocol to Base Sepolia testnet.
///         Uses Circle USDC on Base Sepolia as the primary payment token.
///         Uses real Chainlink VRF v2.5 with funded subscription.
///
/// IMPORTANT: After deployment, add the VRFDispatcher address as a consumer
///            on your subscription at vrf.chain.link.
///
/// Usage:
///   forge script script/DeployBase.s.sol:DeployBase \
///     --rpc-url https://sepolia.base.org \
///     --broadcast -vvvv
///
/// Required env vars:
///   PRIVATE_KEY — deployer wallet (also becomes protocol fee recipient)
contract DeployBase is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Chain: Base Sepolia (84532)");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Payment tokens — USDC + USDT on Base Sepolia
        address usdc = 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // Circle USDC on Base Sepolia
        address usdt = 0x8d9cb8f3191Fd685e2C14D2AC3Fb2b16D44EAfc3; // Tether USDT on Base Sepolia

        // Build accepted tokens list: USDC + USDT (both 6 decimals)
        address[] memory tokens = new address[](2);
        uint8[] memory decimals = new uint8[](2);
        tokens[0] = usdc;
        decimals[0] = 6;
        tokens[1] = usdt;
        decimals[1] = 6;

        // 2. Deploy standalone contracts
        BeneficiaryRegistry beneficiaryRegistry = new BeneficiaryRegistry();
        console.log("BeneficiaryRegistry:", address(beneficiaryRegistry));

        // AgentRegistry uses USDC for bonds, $1 minimum
        AgentRegistry agentRegistry = new AgentRegistry(usdc, 1e6);
        console.log("AgentRegistry:", address(agentRegistry));

        TicketNFT ticketNFT = new TicketNFT();
        console.log("TicketNFT:", address(ticketNFT));

        ReceiptSBT receiptSBT = new ReceiptSBT();
        console.log("ReceiptSBT:", address(receiptSBT));

        RaffleRegistry raffleRegistry = new RaffleRegistry();
        console.log("RaffleRegistry:", address(raffleRegistry));

        // 3. Deploy VRFDispatcher with Chainlink VRF v2.5
        //    Coordinator and key hash: https://docs.chain.link/vrf/v2-5/supported-networks#base-sepolia-testnet
        address vrfCoordinator = 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE; // Base Sepolia VRF v2.5
        bytes32 keyHash = 0x9e9e46732b32662b9adc6f3abdf6c5e926a666d174a4d6b8e39c4cca76a38897; // 500 gwei lane
        uint256 subscriptionId = 73946797020157857277221563581040345401843865455304900649818093121317090894752;
        uint32 callbackGasLimit = 500000; // generous limit for winner selection + payout logic

        // factory_ is set to deployer initially; updated after factory is deployed via setFactory()
        VRFDispatcher vrfDispatcher = new VRFDispatcher(
            vrfCoordinator,
            subscriptionId,
            keyHash,
            callbackGasLimit,
            deployer // temporary factory; updated below
        );
        console.log("VRFDispatcher:", address(vrfDispatcher));

        // 4. Deploy vault implementation
        RaffleVault vaultImpl = new RaffleVault();
        console.log("RaffleVault (impl):", address(vaultImpl));

        // 5. Deploy factory with multi-token support
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
            deployer
        );
        console.log("RaffleFactory:", address(factory));

        // 6. Wire up permissions
        raffleRegistry.authorizeFactory(address(factory));
        agentRegistry.authorizeFactory(address(factory));
        ticketNFT.transferOwnership(address(factory));
        receiptSBT.transferOwnership(address(factory));
        vrfDispatcher.setFactory(address(factory)); // allow factory to call authorizeVault()

        // 7. Register deployer as test beneficiary
        beneficiaryRegistry.registerBeneficiary(
            deployer,
            "Test Charity",
            "charity",
            "RaffleTime Base Sepolia"
        );
        console.log("Registered deployer as test beneficiary");

        vm.stopBroadcast();

        // Print summary for copy-paste into .env files
        console.log("\n========== Copy to packages/agent/.env ==========");
        console.log("CHAIN_ID=84532");
        console.log("RPC_URL=https://sepolia.base.org");
        console.log("FACTORY_ADDRESS=%s", vm.toString(address(factory)));
        console.log("REGISTRY_ADDRESS=%s", vm.toString(address(raffleRegistry)));
        console.log("AGENT_REGISTRY_ADDRESS=%s", vm.toString(address(agentRegistry)));
        console.log("PAYMENT_TOKEN_ADDRESS=%s", vm.toString(usdc));
        console.log("USDT_ADDRESS=%s", vm.toString(usdt));
        console.log("VRF_DISPATCHER_ADDRESS=%s", vm.toString(address(vrfDispatcher)));
        console.log("==================================");
        console.log("\n*** IMPORTANT: Add VRFDispatcher as a consumer on your subscription ***");
        console.log("*** Go to vrf.chain.link > your subscription > Add Consumer ***");
        console.log("*** Consumer address: %s ***", vm.toString(address(vrfDispatcher)));
    }
}
