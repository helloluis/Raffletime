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
import {MockRandomness} from "../src/mocks/MockRandomness.sol";
import "../src/mocks/MockERC20.sol";

/// @title DeployTestnet
/// @notice Deploys the full RaffleTime protocol to Celo Sepolia testnet.
///         Deploys a MockERC20 as the payment token (testnet has no faucet for cUSD).
///         Uses MockWitnetRandomness for VRF (real Witnet at 0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB on mainnet).
///
/// Usage:
///   forge script script/DeployAlfajores.s.sol:DeployTestnet \
///     --rpc-url https://forno.celo-sepolia.celo-testnet.org \
///     --broadcast -vvvv
///
/// Required env vars:
///   PRIVATE_KEY           — deployer wallet (also becomes protocol fee recipient)
///
/// Optional env vars:
///   PAYMENT_TOKEN_ADDRESS — use an existing ERC-20 instead of deploying MockERC20
contract DeployTestnet is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Payment token — deploy MockERC20 unless an existing address is provided
        address paymentToken;
        address envToken = vm.envOr("PAYMENT_TOKEN_ADDRESS", address(0));
        if (envToken != address(0)) {
            paymentToken = envToken;
            console.log("Using existing payment token:", paymentToken);
        } else {
            MockERC20 mockToken = new MockERC20();
            paymentToken = address(mockToken);
            console.log("Deployed MockERC20:", paymentToken);

            // Mint 10,000 test tokens to deployer
            mockToken.mint(deployer, 10_000e18);
            console.log("Minted 10,000 tokens to deployer");
        }

        // 2. Deploy standalone contracts
        BeneficiaryRegistry beneficiaryRegistry = new BeneficiaryRegistry();
        console.log("BeneficiaryRegistry:", address(beneficiaryRegistry));

        AgentRegistry agentRegistry = new AgentRegistry(paymentToken);
        console.log("AgentRegistry:", address(agentRegistry));

        TicketNFT ticketNFT = new TicketNFT();
        console.log("TicketNFT:", address(ticketNFT));

        ReceiptSBT receiptSBT = new ReceiptSBT();
        console.log("ReceiptSBT:", address(receiptSBT));

        RaffleRegistry raffleRegistry = new RaffleRegistry();
        console.log("RaffleRegistry:", address(raffleRegistry));

        // 3. Deploy mock VRF (use real Witnet address 0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB on mainnet)
        MockRandomness mockRandomness = new MockRandomness();
        console.log("MockRandomness:", address(mockRandomness));

        // 4. Deploy vault implementation (clone target, never used directly)
        RaffleVault vaultImpl = new RaffleVault();
        console.log("RaffleVault (impl):", address(vaultImpl));

        // 5. Deploy factory
        RaffleFactory factory = new RaffleFactory(
            address(vaultImpl),
            paymentToken,
            address(ticketNFT),
            address(receiptSBT),
            address(agentRegistry),
            address(beneficiaryRegistry),
            address(raffleRegistry),
            address(mockRandomness),
            deployer // protocol fee recipient = deployer for now
        );
        console.log("RaffleFactory:", address(factory));

        // 6. Wire up permissions
        raffleRegistry.authorizeFactory(address(factory));
        agentRegistry.authorizeFactory(address(factory));
        ticketNFT.transferOwnership(address(factory));
        receiptSBT.transferOwnership(address(factory));

        // 7. Register deployer as a test beneficiary
        beneficiaryRegistry.registerBeneficiary(
            deployer,
            "Test Charity",
            "charity",
            "RaffleTime testnet"
        );
        console.log("Registered deployer as test beneficiary");

        vm.stopBroadcast();

        // Print summary for .env
        console.log("\n========== Copy to .env ==========");
        console.log("FACTORY_ADDRESS=%s", vm.toString(address(factory)));
        console.log("REGISTRY_ADDRESS=%s", vm.toString(address(raffleRegistry)));
        console.log("AGENT_REGISTRY_ADDRESS=%s", vm.toString(address(agentRegistry)));
        console.log("PAYMENT_TOKEN_ADDRESS=%s", vm.toString(paymentToken));
        console.log("BENEFICIARY_REGISTRY_ADDRESS=%s", vm.toString(address(beneficiaryRegistry)));
        console.log("RANDOMNESS_ORACLE_ADDRESS=%s", vm.toString(address(mockRandomness)));
        console.log("BENEFICIARIES=%s", vm.toString(deployer));
        console.log("==================================");
    }
}
