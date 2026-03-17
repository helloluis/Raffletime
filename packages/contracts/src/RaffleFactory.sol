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

interface IVRFDispatcherAuth {
    function authorizeVault(address vault) external;
}

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
    address[] public acceptedTokens;
    mapping(address => uint8) public tokenDecimals;
    IERC20 public depositToken; // token used for ARO deposits (first accepted token)
    TicketNFT public ticketNFT;
    ReceiptSBT public receiptSBT;
    AgentRegistry public agentRegistry;
    BeneficiaryRegistry public beneficiaryRegistry;
    RaffleRegistry public raffleRegistry;
    address public vrfDispatcher;

    /// @notice Protocol fee recipient
    address public protocolFeeRecipient;

    // ============ Deposit calculation constants ============

    /// @notice Deposit amounts in 6-decimal USD
    uint256 public constant MIN_DEPOSIT_USD6 = 100000; // $0.10
    uint256 public constant BASE_DEPOSIT_USD6 = 1000000; // $1.00
    uint256 public constant REFERENCE_SIZE_USD6 = 100000000; // $100

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
        address[] memory acceptedTokens_,
        uint8[] memory tokenDecimals_,
        address ticketNFT_,
        address receiptSBT_,
        address agentRegistry_,
        address beneficiaryRegistry_,
        address raffleRegistry_,
        address vrfDispatcher_,
        address protocolFeeRecipient_
    ) Ownable(msg.sender) {
        require(acceptedTokens_.length > 0, "Need at least 1 token");
        require(acceptedTokens_.length == tokenDecimals_.length, "Token/decimals mismatch");
        vaultImplementation = vaultImplementation_;
        for (uint256 i = 0; i < acceptedTokens_.length; i++) {
            acceptedTokens.push(acceptedTokens_[i]);
            tokenDecimals[acceptedTokens_[i]] = tokenDecimals_[i];
        }
        depositToken = IERC20(acceptedTokens_[0]); // deposits in first token
        ticketNFT = TicketNFT(ticketNFT_);
        receiptSBT = ReceiptSBT(receiptSBT_);
        agentRegistry = AgentRegistry(agentRegistry_);
        beneficiaryRegistry = BeneficiaryRegistry(beneficiaryRegistry_);
        raffleRegistry = RaffleRegistry(raffleRegistry_);
        vrfDispatcher = vrfDispatcher_;
        protocolFeeRecipient = protocolFeeRecipient_;
    }

    /// @notice Create a new raffle by deploying a RaffleVault clone.
    /// @param params_ The raffle configuration parameters
    /// @return vault The address of the deployed RaffleVault clone
    function createRaffle(RaffleVault.RaffleParams calldata params_) external returns (address vault) {
        // Require agent registration
        require(agentRegistry.isRegistered(msg.sender), "Agent not registered");

        // Calculate and take dynamic deposit (in first accepted token)
        uint256 deposit = calculateDeposit(params_.targetPoolSize);
        depositToken.safeTransferFrom(msg.sender, address(this), deposit);

        // Build token arrays for vault initialization
        uint8[] memory decimals_ = new uint8[](acceptedTokens.length);
        for (uint256 i = 0; i < acceptedTokens.length; i++) {
            decimals_[i] = tokenDecimals[acceptedTokens[i]];
        }

        // Deploy clone
        vault = vaultImplementation.clone();

        // Initialize the vault
        RaffleVault(vault).initialize(
            params_,
            msg.sender,
            acceptedTokens,
            decimals_,
            address(ticketNFT),
            address(receiptSBT),
            address(agentRegistry),
            address(beneficiaryRegistry),
            vrfDispatcher,
            address(this)
        );

        // Authorize the vault to mint tickets/receipts and manage stakes
        ticketNFT.authorizeMinter(vault);
        receiptSBT.authorizeMinter(vault);
        agentRegistry.authorizeVault(vault);
        IVRFDispatcherAuth(vrfDispatcher).authorizeVault(vault);

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
        RaffleVault raffleVault = RaffleVault(vault);
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

        depositToken.safeTransfer(msg.sender, aroRefund);
        depositToken.safeTransfer(protocolFeeRecipient, protocolFee);

        emit DepositRefunded(msg.sender, vault, aroRefund, protocolFee);
    }

    /// @notice Protocol can sweep unclaimed deposits after SWEEP_TIMEOUT.
    ///         Covers abandoned raffles where the ARO never claims.
    /// @param vault The raffle vault address
    function sweepDeposit(address vault) external {
        require(aroDeposits[vault] > 0, "Nothing to sweep");

        RaffleVault raffleVault = RaffleVault(vault);
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

        depositToken.safeTransfer(protocolFeeRecipient, deposit);
        emit DepositSwept(vault, deposit);
    }

    // ============ Deposit calculation ============

    /// @notice Calculate the required deposit for creating a raffle.
    ///         Uses the same sqrt scaling as agent staking.
    ///         deposit = max(MIN_DEPOSIT, BASE_DEPOSIT × sqrt(targetPoolSize / REFERENCE_SIZE))
    /// @param targetPoolSizeUsd6 The ARO-configured expected pool size in USD cents
    /// @return The required deposit amount
    /// @notice Calculate required ARO deposit in USD cents based on target pool size (also in cents).
    function calculateDepositUsd6(uint256 targetPoolSizeUsd6) public pure returns (uint256) {
        if (targetPoolSizeUsd6 == 0) return MIN_DEPOSIT_USD6;

        uint256 scaled = (targetPoolSizeUsd6 * 1e18) / REFERENCE_SIZE_USD6;
        uint256 sqrtScaled = Math.sqrt(scaled);
        uint256 depositUsd6 = (BASE_DEPOSIT_USD6 * sqrtScaled) / 1e9;

        return depositUsd6 > MIN_DEPOSIT_USD6 ? depositUsd6 : MIN_DEPOSIT_USD6;
    }

    /// @notice Calculate deposit in the deposit token's actual units (accounting for decimals)
    function calculateDeposit(uint256 targetPoolSizeUsd6) public view returns (uint256) {
        uint256 usd6 = calculateDepositUsd6(targetPoolSizeUsd6);
        uint8 dec = tokenDecimals[acceptedTokens[0]];
        return (usd6 * (10 ** uint256(dec))) / 1e6;
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
