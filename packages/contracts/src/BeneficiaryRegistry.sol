// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title BeneficiaryRegistry
/// @notice On-chain registry of verified beneficiary addresses for RaffleTime raffles.
///         Initially owner-curated, with a path toward DAO-governed verification.
contract BeneficiaryRegistry is Ownable {
    struct BeneficiaryInfo {
        string name;
        string category;
        string attestationSource;
        bool isActive;
    }

    mapping(address => BeneficiaryInfo) private _beneficiaries;
    address[] private _beneficiaryList;

    event BeneficiaryRegistered(address indexed beneficiary, string name, string category);
    event BeneficiaryDeactivated(address indexed beneficiary);
    event BeneficiaryReactivated(address indexed beneficiary);

    constructor() Ownable(msg.sender) {}

    /// @notice Register a new verified beneficiary
    /// @param beneficiary The wallet address of the beneficiary
    /// @param name Human-readable name (e.g., "UNICEF")
    /// @param category Category (e.g., "charity", "foundation")
    /// @param attestationSource Source of verification (e.g., "RaffleTime v1", "DAO vote #42")
    function registerBeneficiary(
        address beneficiary,
        string calldata name,
        string calldata category,
        string calldata attestationSource
    ) external onlyOwner {
        require(beneficiary != address(0), "Zero address");
        require(bytes(name).length > 0, "Empty name");
        require(bytes(_beneficiaries[beneficiary].name).length == 0, "Already registered");

        _beneficiaries[beneficiary] = BeneficiaryInfo({
            name: name,
            category: category,
            attestationSource: attestationSource,
            isActive: true
        });
        _beneficiaryList.push(beneficiary);

        emit BeneficiaryRegistered(beneficiary, name, category);
    }

    /// @notice Deactivate a beneficiary (they can no longer be used in new raffles)
    function deactivateBeneficiary(address beneficiary) external onlyOwner {
        require(_beneficiaries[beneficiary].isActive, "Not active");
        _beneficiaries[beneficiary].isActive = false;
        emit BeneficiaryDeactivated(beneficiary);
    }

    /// @notice Reactivate a previously deactivated beneficiary
    function reactivateBeneficiary(address beneficiary) external onlyOwner {
        require(bytes(_beneficiaries[beneficiary].name).length > 0, "Not registered");
        require(!_beneficiaries[beneficiary].isActive, "Already active");
        _beneficiaries[beneficiary].isActive = true;
        emit BeneficiaryReactivated(beneficiary);
    }

    /// @notice Check if an address is a verified active beneficiary
    function isVerifiedBeneficiary(address beneficiary) external view returns (bool) {
        return _beneficiaries[beneficiary].isActive;
    }

    /// @notice Get full info for a beneficiary
    function getBeneficiary(address beneficiary) external view returns (BeneficiaryInfo memory) {
        return _beneficiaries[beneficiary];
    }

    /// @notice Get count of all registered beneficiaries (active and inactive)
    function getBeneficiaryCount() external view returns (uint256) {
        return _beneficiaryList.length;
    }

    /// @notice Get beneficiary address by index
    function getBeneficiaryAt(uint256 index) external view returns (address) {
        require(index < _beneficiaryList.length, "Out of bounds");
        return _beneficiaryList[index];
    }
}
