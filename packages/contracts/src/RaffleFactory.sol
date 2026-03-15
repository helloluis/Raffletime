// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./RaffleVault.sol";
import "./RaffleRegistry.sol";
import "./TicketNFT.sol";
import "./ReceiptSBT.sol";
import "./AgentRegistry.sol";
import "./BeneficiaryRegistry.sol";

/// @title RaffleFactory
/// @notice Deploys new RaffleVault clones (EIP-1167 minimal proxies).
///         Takes a dynamic ARO deposit (sqrt-scaled by targetPoolSize), validates
///         parameters, and registers the raffle. Deposit refund depends on outcome:
///         - SETTLED: ARO gets 80%, protocol gets 20%
///         - INVALID: ARO gets 50%, protocol gets 50%
///         - Unclaimed: protocol sweeps 100% after timeout
contract RaffleFactory is Ownable {
    using SafeERC20 for IERC20;
    using Clones for address;

    /// @notice The vault implementation contract (clone target)
    address public vaultImplementation;

    /// @notice Protocol contracts
    IERC20 public paymentToken;
    TicketNFT public ticketNFT;
    ReceiptSBT public receiptSBT;
    AgentRegistry public agentRegistry;
    BeneficiaryRegistry public beneficiaryRegistry;
    RaffleRegistry public raffleRegistry;
    address public anyrand;

    /// @notice Protocol fee recipient
    address public protocolFeeRecipient;

    // ============ Deposit calculation constants ============

    /// @notice Minimum deposit regardless of raffle size
    uint256 public constant MIN_DEPOSIT = 0.10e18; // $0.10

    /// @notice Base deposit at reference pool size ($100)
    uint256 public constant BASE_DEPOSIT = 1e18; // $1.00

    /// @notice Reference pool size for sqrt formula (same as AgentRegistry)
    uint256 public constant REFERENCE_SIZE = 100e18; // $100

    // ============ Refund tier constants (basis points) ============

    /// @notice ARO refund on successful raffle (SETTLED)
    uint256 public constant SUCCESS_REFUND_BPS = 8000; // 80%

    /// @notice ARO refund on graceful failure (INVALID)
    uint256 public constant FAILURE_REFUND_BPS = 5000; // 50%

    /// @notice Time after raffle ends before protocol can sweep unclaimed deposits
    uint256 public constant SWEEP_TIMEOUT = 90 days;

    // ============ State ============

    /// @notice Tracking ARO deposits for refund
    mapping(address => uint256) public aroDeposits;

    /// @notice All vaults created by this factory
    address[] public deployedVaults;

    event RaffleCreated(address indexed vault, address indexed creator, string name, uint256 deposit);
    event DepositRefunded(address indexed creator, address indexed vault, uint256 aroAmount, uint256 protocolAmount);
    event DepositSwept(address indexed vault, uint256 amount);

    constructor(
        address vaultImplementation_,
        address paymentToken_,
        address ticketNFT_,
        address receiptSBT_,
        address agentRegistry_,
        address beneficiaryRegistry_,
        address raffleRegistry_,
        address anyrand_,
        address protocolFeeRecipient_
    ) Ownable(msg.sender) {
        vaultImplementation = vaultImplementation_;
        paymentToken = IERC20(paymentToken_);
        ticketNFT = TicketNFT(ticketNFT_);
        receiptSBT = ReceiptSBT(receiptSBT_);
        agentRegistry = AgentRegistry(agentRegistry_);
        beneficiaryRegistry = BeneficiaryRegistry(beneficiaryRegistry_);
        raffleRegistry = RaffleRegistry(raffleRegistry_);
        anyrand = anyrand_;
        protocolFeeRecipient = protocolFeeRecipient_;
    }

    /// @notice Create a new raffle by deploying a RaffleVault clone.
    /// @param params_ The raffle configuration parameters
    /// @return vault The address of the deployed RaffleVault clone
    function createRaffle(RaffleVault.RaffleParams calldata params_) external returns (address vault) {
        // Require agent registration
        require(agentRegistry.isRegistered(msg.sender), "Agent not registered");

        // Calculate and take dynamic deposit
        uint256 deposit = calculateDeposit(params_.targetPoolSize);
        paymentToken.safeTransferFrom(msg.sender, address(this), deposit);

        // Deploy clone
        vault = vaultImplementation.clone();

        // Initialize the vault
        RaffleVault(payable(vault)).initialize(
            params_,
            msg.sender,
            address(paymentToken),
            address(ticketNFT),
            address(receiptSBT),
            address(agentRegistry),
            address(beneficiaryRegistry),
            anyrand,
            address(this)
        );

        // Authorize the vault to mint tickets/receipts and manage stakes
        ticketNFT.authorizeMinter(vault);
        receiptSBT.authorizeMinter(vault);
        agentRegistry.authorizeVault(vault);

        // Register in the global registry
        uint256 closesAt = block.timestamp + params_.duration;
        raffleRegistry.registerRaffle(vault, msg.sender, params_.name, closesAt, params_.targetPoolSize);

        // Track deposit and vault
        aroDeposits[vault] = deposit;
        deployedVaults.push(vault);

        emit RaffleCreated(vault, msg.sender, params_.name, deposit);
    }

    /// @notice Claim deposit refund. Refund amount depends on raffle outcome:
    ///         - SETTLED: 80% to ARO, 20% to protocol
    ///         - INVALID: 50% to ARO, 50% to protocol
    /// @param vault The raffle vault address
    function claimDeposit(address vault) external {
        RaffleVault raffleVault = RaffleVault(payable(vault));
        RaffleVault.State vaultState = raffleVault.state();

        require(
            vaultState == RaffleVault.State.SETTLED || vaultState == RaffleVault.State.INVALID,
            "Raffle not finalized"
        );
        require(raffleVault.creator() == msg.sender, "Not the creator");
        require(aroDeposits[vault] > 0, "Already claimed");

        uint256 deposit = aroDeposits[vault];
        aroDeposits[vault] = 0;

        // Determine refund tier based on outcome
        uint256 refundBps = vaultState == RaffleVault.State.SETTLED
            ? SUCCESS_REFUND_BPS
            : FAILURE_REFUND_BPS;

        uint256 aroRefund = (deposit * refundBps) / 10000;
        uint256 protocolFee = deposit - aroRefund;

        paymentToken.safeTransfer(msg.sender, aroRefund);
        paymentToken.safeTransfer(protocolFeeRecipient, protocolFee);

        emit DepositRefunded(msg.sender, vault, aroRefund, protocolFee);
    }

    /// @notice Protocol can sweep unclaimed deposits after SWEEP_TIMEOUT.
    ///         Covers abandoned raffles where the ARO never claims.
    /// @param vault The raffle vault address
    function sweepDeposit(address vault) external {
        require(aroDeposits[vault] > 0, "Nothing to sweep");

        RaffleVault raffleVault = RaffleVault(payable(vault));
        RaffleVault.State vaultState = raffleVault.state();

        // Must be finalized (SETTLED or INVALID)
        require(
            vaultState == RaffleVault.State.SETTLED || vaultState == RaffleVault.State.INVALID,
            "Raffle not finalized"
        );

        // Must be past the sweep timeout (measured from closesAt)
        require(
            block.timestamp >= raffleVault.closesAt() + SWEEP_TIMEOUT,
            "Sweep timeout not reached"
        );

        uint256 deposit = aroDeposits[vault];
        aroDeposits[vault] = 0;

        paymentToken.safeTransfer(protocolFeeRecipient, deposit);
        emit DepositSwept(vault, deposit);
    }

    // ============ Deposit calculation ============

    /// @notice Calculate the required deposit for creating a raffle.
    ///         Uses the same sqrt scaling as agent staking.
    ///         deposit = max(MIN_DEPOSIT, BASE_DEPOSIT × sqrt(targetPoolSize / REFERENCE_SIZE))
    /// @param targetPoolSize The ARO-configured expected pool size
    /// @return The required deposit amount
    function calculateDeposit(uint256 targetPoolSize) public pure returns (uint256) {
        if (targetPoolSize == 0) return MIN_DEPOSIT;

        uint256 scaled = (targetPoolSize * 1e18) / REFERENCE_SIZE;
        uint256 sqrtScaled = Math.sqrt(scaled);
        uint256 deposit = (BASE_DEPOSIT * sqrtScaled) / 1e9;

        return deposit > MIN_DEPOSIT ? deposit : MIN_DEPOSIT;
    }

    // ============ Admin functions ============

    /// @notice Update the vault implementation for future raffles
    function setVaultImplementation(address newImplementation) external onlyOwner {
        vaultImplementation = newImplementation;
    }

    function setProtocolFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Zero address");
        protocolFeeRecipient = newRecipient;
    }

    // ============ View functions ============

    function getDeployedVaultsCount() external view returns (uint256) {
        return deployedVaults.length;
    }

    function getDeployedVault(uint256 index) external view returns (address) {
        require(index < deployedVaults.length, "Out of bounds");
        return deployedVaults[index];
    }
}
