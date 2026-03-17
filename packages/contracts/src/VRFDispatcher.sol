// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
// Note: VRFConsumerBaseV2Plus already inherits ConfirmedOwner which provides onlyOwner + owner()

interface IRaffleVaultVRF {
    function receiveRandomness(uint256 seed) external;
}

/// @title VRFDispatcher
/// @notice Single Chainlink VRF v2.5 consumer that routes randomness callbacks
///         to RaffleVault clones. Vaults cannot be VRF consumers themselves because
///         they are EIP-1167 minimal proxies — this single contract holds the
///         subscription and dispatches fulfilled randomness to each vault.
contract VRFDispatcher is VRFConsumerBaseV2Plus {

    // ============ VRF Configuration ============

    IVRFCoordinatorV2Plus public immutable coordinator;
    uint256 public subscriptionId;
    bytes32 public keyHash;
    uint32 public callbackGasLimit;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant NUM_WORDS = 1;

    // ============ Request routing ============

    /// @notice Maps a pending VRF requestId → the vault that requested it
    mapping(uint256 => address) public pendingRequests;

    // ============ Access control ============

    /// @notice Only vaults authorized by the factory may request randomness
    mapping(address => bool) public authorizedVaults;
    address public factory;

    // ============ Events ============

    event RandomnessRequested(uint256 indexed requestId, address indexed vault);
    event RandomnessFulfilled(uint256 indexed requestId, address indexed vault, uint256 seed);
    event VaultAuthorized(address indexed vault);

    constructor(
        address vrfCoordinator_,
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint32 callbackGasLimit_,
        address factory_
    )
        VRFConsumerBaseV2Plus(vrfCoordinator_)
    {
        coordinator = IVRFCoordinatorV2Plus(vrfCoordinator_);
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        callbackGasLimit = callbackGasLimit_;
        factory = factory_;
    }

    // ============ Vault authorization (called by factory on each new clone) ============

    function authorizeVault(address vault) external {
        require(msg.sender == factory, "Only factory");
        authorizedVaults[vault] = true;
        emit VaultAuthorized(vault);
    }

    function setFactory(address factory_) external onlyOwner {
        factory = factory_;
    }

    // ============ VRF request (called by vault.requestDraw()) ============

    function requestRandomness(address vault) external returns (uint256 requestId) {
        require(authorizedVaults[vault], "Vault not authorized");
        require(msg.sender == vault, "Only vault can request for itself");

        requestId = coordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: callbackGasLimit,
                numWords: NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );
        pendingRequests[requestId] = vault;
        emit RandomnessRequested(requestId, vault);
    }

    // ============ VRF callback (called by Chainlink coordinator) ============

    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        address vault = pendingRequests[requestId];
        require(vault != address(0), "Unknown requestId");
        delete pendingRequests[requestId]; // CEI: clear before external call
        uint256 seed = randomWords[0];
        emit RandomnessFulfilled(requestId, vault, seed);
        IRaffleVaultVRF(vault).receiveRandomness(seed);
    }

    // ============ Owner config ============

    function setSubscriptionId(uint256 subscriptionId_) external onlyOwner {
        subscriptionId = subscriptionId_;
    }

    function setKeyHash(bytes32 keyHash_) external onlyOwner {
        keyHash = keyHash_;
    }

    function setCallbackGasLimit(uint32 callbackGasLimit_) external onlyOwner {
        callbackGasLimit = callbackGasLimit_;
    }

    // ============ Emergency recovery ============

    /// @notice Manually fulfill a stuck vault with a chosen seed. Owner only.
    ///         Use when Chainlink fails to deliver (wrong key hash, oracle outage, etc.)
    function emergencyFulfill(address vault, uint256 seed) external onlyOwner {
        require(vault != address(0), "Zero address");
        IRaffleVaultVRF(vault).receiveRandomness(seed);
        emit RandomnessFulfilled(0, vault, seed);
    }
}
