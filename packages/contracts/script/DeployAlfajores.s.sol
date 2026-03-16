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
///         Supports multiple payment tokens (USDC, cUSD, mock tokens).
///         Uses MockRandomness for VRF (real Witnet at 0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB on mainnet).
///
/// Usage:
///   forge script script/DeployAlfajores.s.sol:DeployTestnet \
///     --rpc-url https://forno.celo-sepolia.celo-testnet.org \
///     --broadcast -vvvv
///
/// Required env vars:
///   PRIVATE_KEY — deployer wallet (also becomes protocol fee recipient)
contract DeployTestnet is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Payment tokens — USDC on Celo Sepolia + optional MockERC20
        address usdc = 0x01C5C0122039549AD1493B8220cABEdD739BC44E; // Circle USDC on Celo Sepolia

        // Also deploy a MockERC20 for testing
        MockERC20 mockToken = new MockERC20();
        console.log("Deployed MockERC20:", address(mockToken));
        mockToken.mint(deployer, 10_000e18);

        // Build accepted tokens list
        // USDC = 6 decimals, MockERC20 = 18 decimals
        address[] memory tokens = new address[](2);
        uint8[] memory decimals = new uint8[](2);
        tokens[0] = usdc;
        decimals[0] = 6;
        tokens[1] = address(mockToken);
        decimals[1] = 18;

        // 2. Deploy standalone contracts
        BeneficiaryRegistry beneficiaryRegistry = new BeneficiaryRegistry();
        console.log("BeneficiaryRegistry:", address(beneficiaryRegistry));

        // AgentRegistry uses USDC for staking, $1 bond = 1e6
        AgentRegistry agentRegistry = new AgentRegistry(usdc, 1e6);
        console.log("AgentRegistry:", address(agentRegistry));

        TicketNFT ticketNFT = new TicketNFT();
        console.log("TicketNFT:", address(ticketNFT));

        ReceiptSBT receiptSBT = new ReceiptSBT();
        console.log("ReceiptSBT:", address(receiptSBT));

        RaffleRegistry raffleRegistry = new RaffleRegistry();
        console.log("RaffleRegistry:", address(raffleRegistry));

        // 3. Deploy mock VRF
        MockRandomness mockRandomness = new MockRandomness();
        console.log("MockRandomness:", address(mockRandomness));

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
            address(mockRandomness),
            deployer
        );
        console.log("RaffleFactory:", address(factory));

        // 6. Wire up permissions
        raffleRegistry.authorizeFactory(address(factory));
        agentRegistry.authorizeFactory(address(factory));
        ticketNFT.transferOwnership(address(factory));
        receiptSBT.transferOwnership(address(factory));

        // 7. Register deployer as test beneficiary
        beneficiaryRegistry.registerBeneficiary(
            deployer,
            "Test Charity",
            "charity",
            "RaffleTime testnet"
        );
        console.log("Registered deployer as test beneficiary");

        vm.stopBroadcast();

        // Print summary
        console.log("\n========== Copy to .env ==========");
        console.log("FACTORY_ADDRESS=%s", vm.toString(address(factory)));
        console.log("REGISTRY_ADDRESS=%s", vm.toString(address(raffleRegistry)));
        console.log("AGENT_REGISTRY_ADDRESS=%s", vm.toString(address(agentRegistry)));
        console.log("USDC_ADDRESS=%s", vm.toString(usdc));
        console.log("MOCK_TOKEN_ADDRESS=%s", vm.toString(address(mockToken)));
        console.log("BENEFICIARY_REGISTRY_ADDRESS=%s", vm.toString(address(beneficiaryRegistry)));
        console.log("RANDOMNESS_ORACLE_ADDRESS=%s", vm.toString(address(mockRandomness)));
        console.log("BENEFICIARIES=%s", vm.toString(deployer));
        console.log("==================================");
    }
}
