// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./RaffleVault.sol";

/// @title RaffleRegistry
/// @notice Global index of all RaffleTime raffles. Used by the frontend and agents
///         to discover active, completed, and settled raffles.
contract RaffleRegistry is Ownable {
    struct RaffleEntry {
        address vault;
        address creator;
        string name;
        uint256 createdAt;
        uint256 closesAt;
        uint256 targetPoolSize;
    }

    RaffleEntry[] private _raffles;
    mapping(address => uint256[]) private _rafflesByCreator;
    mapping(address => bool) public authorizedFactories;

    event RaffleRegistered(uint256 indexed index, address indexed vault, address indexed creator, string name);
    event FactoryAuthorized(address indexed factory);
    event FactoryRevoked(address indexed factory);

    modifier onlyFactory() {
        require(authorizedFactories[msg.sender], "Not authorized factory");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function authorizeFactory(address factory_) external onlyOwner {
        authorizedFactories[factory_] = true;
        emit FactoryAuthorized(factory_);
    }

    function revokeFactory(address factory_) external onlyOwner {
        authorizedFactories[factory_] = false;
        emit FactoryRevoked(factory_);
    }

    /// @notice Register a new raffle. Called by RaffleFactory after deployment.
    function registerRaffle(
        address vault,
        address creator_,
        string calldata name,
        uint256 closesAt_,
        uint256 targetPoolSize
    ) external onlyFactory returns (uint256 index) {
        index = _raffles.length;
        _raffles.push(
            RaffleEntry({
                vault: vault,
                creator: creator_,
                name: name,
                createdAt: block.timestamp,
                closesAt: closesAt_,
                targetPoolSize: targetPoolSize
            })
        );
        _rafflesByCreator[creator_].push(index);

        emit RaffleRegistered(index, vault, creator_, name);
    }

    // ============ View functions ============

    function getRaffle(uint256 index) external view returns (RaffleEntry memory) {
        require(index < _raffles.length, "Out of bounds");
        return _raffles[index];
    }

    function getRaffleCount() external view returns (uint256) {
        return _raffles.length;
    }

    function getRafflesByCreator(address creator_) external view returns (uint256[] memory) {
        return _rafflesByCreator[creator_];
    }

    /// @notice Get active raffles (closesAt > now). Returns vault addresses.
    ///         Note: This is a convenience view; for large registries, use events for indexing.
    function getActiveRaffles() external view returns (address[] memory) {
        // Count active
        uint256 count = 0;
        for (uint256 i = 0; i < _raffles.length; i++) {
            if (_raffles[i].closesAt > block.timestamp) {
                count++;
            }
        }

        address[] memory active = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < _raffles.length; i++) {
            if (_raffles[i].closesAt > block.timestamp) {
                active[j++] = _raffles[i].vault;
            }
        }

        return active;
    }
}
