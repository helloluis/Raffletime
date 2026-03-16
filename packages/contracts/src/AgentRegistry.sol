// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @title AgentRegistry
/// @notice ERC-8004 compliant agent identity registry with dynamic staking.
///         Agents register by minting an identity NFT. To enter raffles, they must
///         stake collateral that scales with raffle size (sqrt scaling + 25% overflow brackets).
contract AgentRegistry is ERC721, Ownable {
    using SafeERC20 for IERC20;

    uint256 private _nextAgentId = 1;

    /// @notice The stablecoin used for staking (cUSD on Celo)
    IERC20 public immutable stakeToken;

    /// @notice Minimum stake regardless of raffle size (in token decimals)
    uint256 public constant MIN_STAKE = 0.01e18; // $0.01

    /// @notice Base stake used in the sqrt formula (in token decimals)
    uint256 public constant BASE_STAKE = 0.10e18; // $0.10

    /// @notice Reference pool size for the sqrt formula (in token decimals)
    uint256 public constant REFERENCE_SIZE = 100e18; // $100

    /// @notice Minimum registration age before an agent can enter Tier 2+ raffles
    uint256 public constant MIN_REGISTRATION_AGE = 7 days;

    /// @notice Minimum admission bond required to register (sybil resistance)
    /// Set in constructor based on staking token decimals ($1)
    uint256 public immutable MIN_BOND;

    /// @notice Cooldown period before a bond withdrawal is finalized
    uint256 public constant BOND_COOLDOWN = 14 days;

    struct AgentInfo {
        string agentURI; // Points to agent registration file (ERC-8004)
        uint256 registeredAt;
        uint256 totalRafflesEntered;
        uint256 totalRafflesWon;
        bool suspended;
        string suspensionReason;
        uint256 bondAmount; // Admission bond deposited at registration
        uint256 withdrawRequestedAt; // 0 = no withdrawal pending
    }

    struct RaffleStake {
        uint256 amount;
        bool claimed;
    }

    /// @notice Agent info by token ID
    mapping(uint256 => AgentInfo) private _agents;

    /// @notice Token ID by address (each address can only register one agent)
    mapping(address => uint256) private _agentIdByAddress;

    /// @notice Stakes: agentId => raffleAddress => stake info
    mapping(uint256 => mapping(address => RaffleStake)) private _stakes;

    /// @notice Addresses authorized to call returnStake/recordWin (raffle vaults)
    mapping(address => bool) public authorizedVaults;

    /// @notice Addresses authorized to authorize vaults (raffle factories)
    mapping(address => bool) public authorizedFactories;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI, uint256 bondAmount);
    event AgentURIUpdated(uint256 indexed agentId, string newURI);
    event Staked(uint256 indexed agentId, address indexed raffle, uint256 amount);
    event StakeReturned(uint256 indexed agentId, address indexed raffle, uint256 amount);
    event VaultAuthorized(address indexed vault);
    event VaultDeauthorized(address indexed vault);
    event FactoryAuthorized(address indexed factory);
    event AgentSuspended(uint256 indexed agentId, address indexed agent, string reason);
    event AgentReinstated(uint256 indexed agentId, address indexed agent);
    event BondWithdrawRequested(uint256 indexed agentId, address indexed agent, uint256 completesAt);
    event BondWithdrawn(uint256 indexed agentId, address indexed agent, uint256 amount);
    event BondWithdrawCancelled(uint256 indexed agentId, address indexed agent);
    event BondSlashed(uint256 indexed agentId, address indexed agent, uint256 amount);

    modifier onlyAuthorizedVault() {
        require(authorizedVaults[msg.sender], "Not authorized vault");
        _;
    }

    constructor(address stakeToken_, uint256 minBond_) ERC721("RaffleTime Agent", "RTA") Ownable(msg.sender) {
        stakeToken = IERC20(stakeToken_);
        MIN_BOND = minBond_;
    }

    /// @notice Authorize a factory to create and authorize vaults
    function authorizeFactory(address factory_) external onlyOwner {
        authorizedFactories[factory_] = true;
        emit FactoryAuthorized(factory_);
    }

    /// @notice Authorize a vault address to call returnStake/recordWin.
    ///         Callable by owner or authorized factories.
    function authorizeVault(address vault) external {
        require(msg.sender == owner() || authorizedFactories[msg.sender], "Not authorized");
        authorizedVaults[vault] = true;
        emit VaultAuthorized(vault);
    }

    /// @notice Remove vault authorization
    function deauthorizeVault(address vault) external onlyOwner {
        authorizedVaults[vault] = false;
        emit VaultDeauthorized(vault);
    }

    /// @notice Suspend an agent for abusive behavior. Suspended agents cannot enter raffles.
    /// @param agentId The agent's NFT token ID
    /// @param reason Human-readable reason (stored on-chain for transparency)
    function suspendAgent(uint256 agentId, string calldata reason) external onlyOwner {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        require(!_agents[agentId].suspended, "Already suspended");
        require(bytes(reason).length > 0, "Empty reason");

        _agents[agentId].suspended = true;
        _agents[agentId].suspensionReason = reason;

        emit AgentSuspended(agentId, ownerOf(agentId), reason);
    }

    /// @notice Reinstate a previously suspended agent
    /// @param agentId The agent's NFT token ID
    function reinstateAgent(uint256 agentId) external onlyOwner {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        require(_agents[agentId].suspended, "Not suspended");

        _agents[agentId].suspended = false;
        _agents[agentId].suspensionReason = "";

        emit AgentReinstated(agentId, ownerOf(agentId));
    }

    /// @notice Check if an agent address is suspended
    function isSuspended(address agent) external view returns (bool) {
        uint256 agentId = _agentIdByAddress[agent];
        if (agentId == 0) return false;
        return _agents[agentId].suspended;
    }

    /// @notice Prevent transfers — agent NFTs are soul-bound
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow minting (from == address(0)), block all transfers
        require(from == address(0), "Agent NFTs are non-transferable");
        return super._update(to, tokenId, auth);
    }

    /// @notice Register a new agent identity by minting a soulbound NFT and depositing a bond.
    /// @param agentURI URI pointing to agent registration file (ERC-8004 format)
    /// @param bondAmount Amount of stakeToken to deposit as admission bond (must be >= MIN_BOND)
    function registerAgent(string calldata agentURI, uint256 bondAmount) external returns (uint256 agentId) {
        require(_agentIdByAddress[msg.sender] == 0, "Already registered");
        require(bytes(agentURI).length > 0, "Empty URI");
        require(bondAmount >= MIN_BOND, "Bond below minimum");

        // Take the bond
        stakeToken.safeTransferFrom(msg.sender, address(this), bondAmount);

        agentId = _nextAgentId++;
        _mint(msg.sender, agentId);

        _agents[agentId] = AgentInfo({
            agentURI: agentURI,
            registeredAt: block.timestamp,
            totalRafflesEntered: 0,
            totalRafflesWon: 0,
            suspended: false,
            suspensionReason: "",
            bondAmount: bondAmount,
            withdrawRequestedAt: 0
        });
        _agentIdByAddress[msg.sender] = agentId;

        emit AgentRegistered(agentId, msg.sender, agentURI, bondAmount);
    }

    /// @notice Update the agent registration URI
    function updateAgentURI(uint256 agentId, string calldata newURI) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        require(bytes(newURI).length > 0, "Empty URI");
        _agents[agentId].agentURI = newURI;
        emit AgentURIUpdated(agentId, newURI);
    }

    // ============ Admission Bond Management ============

    /// @notice Request withdrawal of admission bond. Starts a 2-week cooldown.
    ///         During cooldown the bond is still active. After cooldown, call completeBondWithdrawal().
    function requestBondWithdrawal() external {
        uint256 agentId = _agentIdByAddress[msg.sender];
        require(agentId != 0, "Not registered");
        AgentInfo storage info = _agents[agentId];
        require(info.bondAmount > 0, "No bond");
        require(info.withdrawRequestedAt == 0, "Withdrawal already pending");

        info.withdrawRequestedAt = block.timestamp;

        emit BondWithdrawRequested(agentId, msg.sender, block.timestamp + BOND_COOLDOWN);
    }

    /// @notice Cancel a pending bond withdrawal request.
    function cancelBondWithdrawal() external {
        uint256 agentId = _agentIdByAddress[msg.sender];
        require(agentId != 0, "Not registered");
        AgentInfo storage info = _agents[agentId];
        require(info.withdrawRequestedAt != 0, "No withdrawal pending");

        info.withdrawRequestedAt = 0;

        emit BondWithdrawCancelled(agentId, msg.sender);
    }

    /// @notice Complete a bond withdrawal after the cooldown period.
    ///         Returns the full bond. Agent loses ability to participate until re-bonded.
    function completeBondWithdrawal() external {
        uint256 agentId = _agentIdByAddress[msg.sender];
        require(agentId != 0, "Not registered");
        AgentInfo storage info = _agents[agentId];
        require(info.withdrawRequestedAt != 0, "No withdrawal pending");
        require(block.timestamp >= info.withdrawRequestedAt + BOND_COOLDOWN, "Cooldown not elapsed");

        uint256 amount = info.bondAmount;
        info.bondAmount = 0;
        info.withdrawRequestedAt = 0;

        stakeToken.safeTransfer(msg.sender, amount);

        emit BondWithdrawn(agentId, msg.sender, amount);
    }

    /// @notice Deposit additional bond or re-bond after withdrawal.
    function depositBond(uint256 amount) external {
        uint256 agentId = _agentIdByAddress[msg.sender];
        require(agentId != 0, "Not registered");
        AgentInfo storage info = _agents[agentId];

        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        info.bondAmount += amount;

        // Cancel any pending withdrawal if re-bonding
        if (info.withdrawRequestedAt != 0) {
            info.withdrawRequestedAt = 0;
            emit BondWithdrawCancelled(agentId, msg.sender);
        }
    }

    /// @notice Slash an agent's bond. Owner-only. Used for proven abusive behavior.
    /// @param agentId The agent's NFT token ID
    /// @param reason Human-readable reason
    function slashBond(uint256 agentId, string calldata reason) external onlyOwner {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        AgentInfo storage info = _agents[agentId];
        require(info.bondAmount > 0, "No bond to slash");

        uint256 amount = info.bondAmount;
        info.bondAmount = 0;
        info.withdrawRequestedAt = 0;

        // Also suspend the agent
        if (!info.suspended) {
            info.suspended = true;
            info.suspensionReason = reason;
            emit AgentSuspended(agentId, ownerOf(agentId), reason);
        }

        // Send slashed funds to protocol owner
        stakeToken.safeTransfer(owner(), amount);

        emit BondSlashed(agentId, ownerOf(agentId), amount);
    }

    /// @notice Check if an agent has an active bond (required for agentsOnly raffles).
    ///         Bond is active if amount >= MIN_BOND and no withdrawal is pending.
    function hasActiveBond(address agent) external view returns (bool) {
        uint256 agentId = _agentIdByAddress[agent];
        if (agentId == 0) return false;
        AgentInfo storage info = _agents[agentId];
        return info.bondAmount >= MIN_BOND && info.withdrawRequestedAt == 0;
    }

    // ============ Per-Raffle Staking ============

    /// @notice Stake collateral to enter a raffle. Called by the RaffleVault on entry.
    /// @param agentId The agent's NFT token ID
    /// @param raffle The raffle vault address
    /// @param targetPoolSize The raffle's configured target pool size
    /// @param actualPoolSize The raffle's current actual pool size
    function stakeForRaffle(uint256 agentId, address raffle, uint256 targetPoolSize, uint256 actualPoolSize) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        require(_stakes[agentId][raffle].amount == 0, "Already staked");

        uint256 required = calculateRequiredStake(targetPoolSize, actualPoolSize);
        stakeToken.safeTransferFrom(msg.sender, address(this), required);

        _stakes[agentId][raffle] = RaffleStake({amount: required, claimed: false});
        _agents[agentId].totalRafflesEntered++;

        emit Staked(agentId, raffle, required);
    }

    /// @notice Return stake after raffle settlement. Called by the RaffleVault.
    /// @param agentId The agent's NFT token ID
    /// @param raffle The raffle vault address
    function returnStake(uint256 agentId, address raffle) external onlyAuthorizedVault {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        RaffleStake storage stake = _stakes[agentId][raffle];
        require(stake.amount > 0, "No stake");
        require(!stake.claimed, "Already claimed");

        stake.claimed = true;
        stakeToken.safeTransfer(ownerOf(agentId), stake.amount);

        emit StakeReturned(agentId, raffle, stake.amount);
    }

    /// @notice Increment win count for an agent. Called by RaffleVault on payout.
    function recordWin(uint256 agentId) external onlyAuthorizedVault {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        _agents[agentId].totalRafflesWon++;
    }

    // ============ Stake Calculation ============

    /// @notice Calculate the required stake for entering a raffle.
    ///         Uses sqrt scaling on targetPoolSize with 25% overflow brackets.
    /// @param targetPoolSize The ARO-configured expected pool size
    /// @param actualPoolSize The current actual pool size
    /// @return The required stake amount in token decimals
    function calculateRequiredStake(uint256 targetPoolSize, uint256 actualPoolSize)
        public
        pure
        returns (uint256)
    {
        uint256 effectivePool = targetPoolSize;

        // Apply 25% overflow brackets if actual exceeds target
        if (actualPoolSize > targetPoolSize && targetPoolSize > 0) {
            // Calculate which 25% bracket we're in
            // overflow = actualPoolSize - targetPoolSize
            // bracketIndex = ceil(overflow / (targetPoolSize * 25 / 100))
            uint256 overflow = actualPoolSize - targetPoolSize;
            uint256 bracketSize = targetPoolSize / 4; // 25% of target
            if (bracketSize == 0) bracketSize = 1;

            uint256 bracketIndex = (overflow + bracketSize - 1) / bracketSize; // ceil division
            // effectivePool = targetPoolSize * (1 + bracketIndex * 0.25)
            // = targetPoolSize + targetPoolSize * bracketIndex / 4
            effectivePool = targetPoolSize + (targetPoolSize * bracketIndex) / 4;
        }

        // stake = max(MIN_STAKE, BASE_STAKE * sqrt(effectivePool / REFERENCE_SIZE))
        // To avoid precision loss: sqrt(effectivePool * 1e18 / REFERENCE_SIZE) * BASE_STAKE / 1e9
        // since sqrt(x * 1e18) = sqrt(x) * 1e9
        if (effectivePool == 0) return MIN_STAKE;

        uint256 scaled = (effectivePool * 1e18) / REFERENCE_SIZE;
        uint256 sqrtScaled = Math.sqrt(scaled); // returns sqrt with 1e9 precision
        uint256 stake = (BASE_STAKE * sqrtScaled) / 1e9;

        return stake > MIN_STAKE ? stake : MIN_STAKE;
    }

    // ============ View Functions ============

    function getAgent(uint256 agentId) external view returns (AgentInfo memory) {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        return _agents[agentId];
    }

    function getAgentIdByAddress(address agent) external view returns (uint256) {
        return _agentIdByAddress[agent];
    }

    function isRegistered(address agent) external view returns (bool) {
        return _agentIdByAddress[agent] != 0;
    }

    function getAgentAge(uint256 agentId) external view returns (uint256) {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        return block.timestamp - _agents[agentId].registeredAt;
    }

    function getStake(uint256 agentId, address raffle) external view returns (uint256 amount, bool claimed) {
        RaffleStake memory s = _stakes[agentId][raffle];
        return (s.amount, s.claimed);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        return _agents[agentId].agentURI;
    }

    function totalAgents() external view returns (uint256) {
        return _nextAgentId - 1;
    }

    // ============ ERC-8004 Metadata ============

    /// @notice Arbitrary key-value metadata per agent (ERC-8004 §metadata)
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    /// @notice Delegated wallet per agent (ERC-8004 §wallet-delegation)
    mapping(uint256 => address) private _agentWallets;

    event MetadataUpdated(uint256 indexed agentId, string key);
    event AgentWalletUpdated(uint256 indexed agentId, address newWallet);

    /// @notice Get metadata value for a given agent and key
    function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory) {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        return _metadata[agentId][key];
    }

    /// @notice Set metadata value. Only the agent owner can set their own metadata.
    function setMetadata(uint256 agentId, string memory key, bytes memory value) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        _metadata[agentId][key] = value;
        emit MetadataUpdated(agentId, key);
    }

    /// @notice Get the delegated wallet for an agent (defaults to NFT owner)
    function getAgentWallet(uint256 agentId) external view returns (address) {
        require(agentId > 0 && agentId < _nextAgentId, "Invalid agent ID");
        address delegated = _agentWallets[agentId];
        return delegated == address(0) ? ownerOf(agentId) : delegated;
    }

    /// @notice Delegate agent actions to a different wallet. Only agent owner can call.
    function setAgentWallet(uint256 agentId, address newWallet) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        _agentWallets[agentId] = newWallet;
        emit AgentWalletUpdated(agentId, newWallet);
    }
}
