// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IRandomnessOracle.sol";
import "./TicketNFT.sol";
import "./ReceiptSBT.sol";
import "./AgentRegistry.sol";
import "./BeneficiaryRegistry.sol";

/// @title RaffleVault
/// @notice Core raffle contract deployed as EIP-1167 minimal proxy clone per raffle.
///         Manages the full raffle lifecycle: OPEN → CLOSED → DRAWING → PAYOUT → SETTLED.
///         Uses Witnet Randomness Oracle (two-step: request → fetch).
contract RaffleVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        UNINITIALIZED,
        OPEN,
        CLOSED,
        DRAWING,
        PAYOUT,
        SETTLED,
        INVALID
    }

    struct RaffleParams {
        string name;
        string description;
        uint256 ticketPrice; // in cUSD decimals (18)
        uint256 maxEntriesPerUser;
        uint256 numWinners;
        uint256 winnerShareBps; // basis points (e.g., 9000 = 90%)
        uint256 beneficiaryShareBps; // basis points (e.g., 1000 = 10%)
        address[] beneficiaryOptions;
        uint256 duration; // in seconds
        uint256 targetPoolSize; // for stake calculation
        uint256 minUniqueParticipants;
        bool agentsOnly; // if true, only ERC-8004 registered agents can enter
    }

    // ============ Immutable-like storage (set once in initialize) ============

    State public state;
    RaffleParams public params;

    address public creator; // ARO address
    uint256 public createdAt;
    uint256 public closesAt;

    IERC20 public paymentToken;
    TicketNFT public ticketNFT;
    ReceiptSBT public receiptSBT;
    AgentRegistry public agentRegistry;
    BeneficiaryRegistry public beneficiaryRegistry;
    IRandomnessOracle public randomnessOracle;
    address public factory;

    // ============ Raffle state ============

    /// @notice Participants (direct entry — recorded immediately)
    address[] public participants;
    mapping(address => uint256) public entryCount;

    /// @notice Unique participant tracking
    uint256 public uniqueParticipantCount;

    /// @notice Beneficiary vote tally
    mapping(address => uint256) public beneficiaryVotes;

    /// @notice Total pool accumulated
    uint256 public totalPool;

    /// @notice Witnet randomness tracking
    uint256 public randomizeBlock;
    bool public drawCompleted;

    /// @notice Selected winners after drawing
    address[] public winners;

    /// @notice Winning beneficiary
    address public winningBeneficiary;

    // ============ Events ============

    event RaffleInitialized(address indexed vault, address indexed creator, string name);
    event EntryAdded(address indexed participant, uint256 ticketNumber, address beneficiaryVote);
    event RaffleClosed(uint256 totalPool, uint256 uniqueParticipants);
    event DrawRequested(uint256 randomizeBlock);
    event DrawCompleted(uint256 randomSeed);
    event WinnersSelected(address[] winners, address winningBeneficiary);
    event PrizeDistributed(address indexed winner, uint256 amount);
    event BeneficiaryPaid(address indexed beneficiary, uint256 amount);
    event RaffleSettled(uint256 receiptTokenId);
    event RaffleInvalidated(string reason);
    event RefundIssued(address indexed participant, uint256 amount);
    event StateTransition(State from, State to);

    modifier onlyState(State expected) {
        require(state == expected, "Invalid state");
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    /// @notice Initialize the vault. Called by RaffleFactory after clone deployment.
    function initialize(
        RaffleParams calldata params_,
        address creator_,
        address paymentToken_,
        address ticketNFT_,
        address receiptSBT_,
        address agentRegistry_,
        address beneficiaryRegistry_,
        address randomnessOracle_,
        address factory_
    ) external {
        require(state == State.UNINITIALIZED, "Already initialized");
        require(params_.winnerShareBps + params_.beneficiaryShareBps == 10000, "Shares must total 100%");
        require(params_.ticketPrice >= 0.01e18 && params_.ticketPrice <= 100e18, "Invalid ticket price");
        require(params_.maxEntriesPerUser >= 1 && params_.maxEntriesPerUser <= 100, "Invalid max entries");
        require(params_.numWinners >= 1, "Need at least 1 winner");
        require(params_.duration > 0, "Zero duration");
        require(
            params_.minUniqueParticipants >= params_.numWinners + 1,
            "Min participants must exceed numWinners"
        );

        // Validate all beneficiary options are verified
        for (uint256 i = 0; i < params_.beneficiaryOptions.length; i++) {
            require(
                BeneficiaryRegistry(beneficiaryRegistry_).isVerifiedBeneficiary(params_.beneficiaryOptions[i]),
                "Unverified beneficiary"
            );
        }

        params = params_;
        creator = creator_;
        createdAt = block.timestamp;
        closesAt = block.timestamp + params_.duration;

        paymentToken = IERC20(paymentToken_);
        ticketNFT = TicketNFT(ticketNFT_);
        receiptSBT = ReceiptSBT(receiptSBT_);
        agentRegistry = AgentRegistry(agentRegistry_);
        beneficiaryRegistry = BeneficiaryRegistry(beneficiaryRegistry_);
        randomnessOracle = IRandomnessOracle(randomnessOracle_);
        factory = factory_;

        state = State.OPEN;
        emit StateTransition(State.UNINITIALIZED, State.OPEN);
        emit RaffleInitialized(address(this), creator_, params_.name);
    }

    // ============ OPEN Phase: Direct entry ============

    /// @notice Enter the raffle directly. Payment is taken and participant is recorded immediately.
    /// @param beneficiaryVote The beneficiary address the participant votes for
    function enterRaffle(address beneficiaryVote) external onlyState(State.OPEN) nonReentrant {
        require(block.timestamp < closesAt, "Raffle period ended");
        require(!agentRegistry.isSuspended(msg.sender), "Agent suspended");
        if (params.agentsOnly) {
            require(agentRegistry.isRegistered(msg.sender), "Agents only");
            require(agentRegistry.hasActiveBond(msg.sender), "Bond required");
        }
        require(entryCount[msg.sender] < params.maxEntriesPerUser, "Max entries reached");

        // Validate beneficiary vote
        if (params.beneficiaryOptions.length > 0) {
            bool validVote = false;
            for (uint256 i = 0; i < params.beneficiaryOptions.length; i++) {
                if (params.beneficiaryOptions[i] == beneficiaryVote) {
                    validVote = true;
                    break;
                }
            }
            require(validVote, "Invalid beneficiary vote");
        }

        // Take payment
        paymentToken.safeTransferFrom(msg.sender, address(this), params.ticketPrice);
        totalPool += params.ticketPrice;

        // Track unique participants
        if (entryCount[msg.sender] == 0) {
            uniqueParticipantCount++;
        }
        entryCount[msg.sender]++;
        participants.push(msg.sender);

        // Track beneficiary vote
        beneficiaryVotes[beneficiaryVote]++;

        // Mint ticket NFT
        uint256 ticketNumber = participants.length;
        ticketNFT.mint(msg.sender, address(this), ticketNumber, beneficiaryVote);

        emit EntryAdded(msg.sender, ticketNumber, beneficiaryVote);
    }

    // ============ CLOSED Phase ============

    /// @notice Close the raffle. Can be called by anyone after the duration expires.
    function closeRaffle() external onlyState(State.OPEN) {
        require(block.timestamp >= closesAt, "Raffle still open");

        state = State.CLOSED;
        emit StateTransition(State.OPEN, State.CLOSED);
        emit RaffleClosed(totalPool, uniqueParticipantCount);
    }

    // ============ DRAWING Phase: Two-step Witnet randomness ============

    /// @notice Step 1: Request randomness from Witnet. Transitions to DRAWING state.
    ///         Must send enough CELO to cover the Witnet fee.
    function requestDraw() external payable onlyState(State.CLOSED) {
        // Check if raffle is valid
        if (uniqueParticipantCount < params.minUniqueParticipants) {
            _invalidateRaffle("Insufficient unique participants");
            return;
        }

        uint256 minTickets = (params.numWinners * params.maxEntriesPerUser) + 1;
        if (participants.length < minTickets) {
            _invalidateRaffle("Insufficient tickets");
            return;
        }

        // Verify enough eligible participants (non-excluded) for numWinners
        uint256 eligibleCount = 0;
        for (uint256 i = 0; i < participants.length; i++) {
            if (!_isExcluded(participants[i])) {
                eligibleCount++;
            }
        }
        if (eligibleCount < params.numWinners) {
            _invalidateRaffle("Insufficient eligible participants");
            return;
        }

        state = State.DRAWING;
        emit StateTransition(State.CLOSED, State.DRAWING);

        // Request randomness from Witnet
        uint256 fee = randomnessOracle.estimateRandomizeFee(tx.gasprice);
        require(msg.value >= fee, "Insufficient CELO for VRF fee");
        randomnessOracle.randomize{value: fee}();
        randomizeBlock = block.number;

        // Refund excess
        if (msg.value > fee) {
            payable(msg.sender).transfer(msg.value - fee);
        }

        emit DrawRequested(randomizeBlock);
    }

    /// @notice Step 2: Fetch the random seed from Witnet and select winners.
    ///         Can be called by anyone once Witnet has fulfilled the randomness.
    function completeDraw() external onlyState(State.DRAWING) {
        require(!drawCompleted, "Draw already completed");
        require(randomizeBlock > 0, "No randomness requested");

        // Fetch randomness — reverts if not yet available
        bytes32 randomSeed = randomnessOracle.fetchRandomnessAfter(randomizeBlock);
        uint256 randomWord = uint256(randomSeed);
        drawCompleted = true;

        emit DrawCompleted(randomWord);

        _selectWinners(randomWord);
    }

    /// @notice Check if the Witnet randomness is ready to be fetched.
    function isRandomnessReady() external view returns (bool) {
        if (randomizeBlock == 0) return false;
        return randomnessOracle.isRandomized(randomizeBlock);
    }

    // ============ Winner selection (shared logic) ============

    function _selectWinners(uint256 randomWord) internal {
        // Pre-filter excluded addresses before running Fisher-Yates
        address[] memory eligible = new address[](participants.length);
        uint256 eligibleCount = 0;
        for (uint256 i = 0; i < participants.length; i++) {
            if (!_isExcluded(participants[i])) {
                eligible[eligibleCount] = participants[i];
                eligibleCount++;
            }
        }

        uint256 numWinners = params.numWinners;
        if (numWinners > eligibleCount) {
            numWinners = eligibleCount;
        }

        // Proper Fisher-Yates with advancing PRNG state
        uint256 currentSeed = randomWord;
        for (uint256 i = 0; i < numWinners; i++) {
            uint256 remaining = eligibleCount - i;
            uint256 j = i + (currentSeed % remaining);
            currentSeed = uint256(keccak256(abi.encode(currentSeed)));
            (eligible[i], eligible[j]) = (eligible[j], eligible[i]);
            winners.push(eligible[i]);
        }

        // Determine winning beneficiary by most votes
        winningBeneficiary = _tallyBeneficiaryVotes();

        require(winners.length > 0, "No eligible winners");

        state = State.PAYOUT;
        emit StateTransition(State.DRAWING, State.PAYOUT);
        emit WinnersSelected(winners, winningBeneficiary);
    }

    // ============ PAYOUT Phase: Distribute prizes ============

    /// @notice Distribute prizes to winners and beneficiary. Transition to SETTLED.
    function distributePrizes() external onlyState(State.PAYOUT) nonReentrant {
        uint256 winnerPool = (totalPool * params.winnerShareBps) / 10000;
        uint256 beneficiaryPool = (totalPool * params.beneficiaryShareBps) / 10000;

        // Pay winners with dust distribution to last winner
        if (winners.length > 0) {
            uint256 prizePerWinner = winnerPool / winners.length;
            uint256 remainder = winnerPool % winners.length;

            for (uint256 i = 0; i < winners.length; i++) {
                uint256 prize = prizePerWinner + (i == winners.length - 1 ? remainder : 0);
                paymentToken.safeTransfer(winners[i], prize);
                emit PrizeDistributed(winners[i], prize);

                uint256 agentId = agentRegistry.getAgentIdByAddress(winners[i]);
                if (agentId > 0) {
                    agentRegistry.recordWin(agentId);
                }
            }
        }

        // Pay beneficiary
        if (winningBeneficiary != address(0) && beneficiaryPool > 0) {
            paymentToken.safeTransfer(winningBeneficiary, beneficiaryPool);
            emit BeneficiaryPaid(winningBeneficiary, beneficiaryPool);
        }

        // Mint settlement receipt SBT
        uint256 receiptId = receiptSBT.mint(address(this), winners, winningBeneficiary, totalPool);

        state = State.SETTLED;
        emit StateTransition(State.PAYOUT, State.SETTLED);
        emit RaffleSettled(receiptId);
    }

    // ============ INVALID: Refund path ============

    function _invalidateRaffle(string memory reason) internal {
        state = State.INVALID;
        emit StateTransition(State.CLOSED, State.INVALID);
        emit RaffleInvalidated(reason);
    }

    /// @notice Claim refund for an invalid raffle (pull-based, for individual participants)
    function claimRefund() external onlyState(State.INVALID) nonReentrant {
        uint256 entries = entryCount[msg.sender];
        require(entries > 0, "No entries");

        entryCount[msg.sender] = 0;
        uint256 refundAmount = entries * params.ticketPrice;

        paymentToken.safeTransfer(msg.sender, refundAmount);

        emit RefundIssued(msg.sender, refundAmount);
    }

    /// @notice Push refunds to all participants at once (callable by anyone).
    ///         Gas cost scales with participant count. For house raffles with
    ///         small participant counts this is practical and provides better UX.
    function distributeRefunds() external onlyState(State.INVALID) nonReentrant {
        uint256 len = participants.length;
        require(len > 0, "No participants");

        for (uint256 i = 0; i < len; i++) {
            address participant = participants[i];
            uint256 entries = entryCount[participant];
            if (entries == 0) continue;

            entryCount[participant] = 0;
            uint256 refundAmount = entries * params.ticketPrice;
            paymentToken.safeTransfer(participant, refundAmount);
            emit RefundIssued(participant, refundAmount);
        }
    }

    // ============ Internal helpers ============

    function _isExcluded(address addr) internal view returns (bool) {
        if (addr == creator) return true;
        for (uint256 i = 0; i < params.beneficiaryOptions.length; i++) {
            if (params.beneficiaryOptions[i] == addr) return true;
        }
        return false;
    }

    function _tallyBeneficiaryVotes() internal view returns (address) {
        if (params.beneficiaryOptions.length == 0) return address(0);
        if (params.beneficiaryOptions.length == 1) return params.beneficiaryOptions[0];

        address topBeneficiary = params.beneficiaryOptions[0];
        uint256 topVotes = beneficiaryVotes[params.beneficiaryOptions[0]];

        for (uint256 i = 1; i < params.beneficiaryOptions.length; i++) {
            if (beneficiaryVotes[params.beneficiaryOptions[i]] > topVotes) {
                topVotes = beneficiaryVotes[params.beneficiaryOptions[i]];
                topBeneficiary = params.beneficiaryOptions[i];
            }
        }

        return topBeneficiary;
    }

    // ============ View functions ============

    function getParticipants() external view returns (address[] memory) {
        return participants;
    }

    function getWinners() external view returns (address[] memory) {
        return winners;
    }

    function getBeneficiaryOptions() external view returns (address[] memory) {
        return params.beneficiaryOptions;
    }

    function getParticipantCount() external view returns (uint256) {
        return participants.length;
    }

    /// @notice Allow the vault to receive CELO for VRF fees
    receive() external payable {}
}
