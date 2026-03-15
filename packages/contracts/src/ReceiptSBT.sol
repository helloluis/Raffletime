// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title ReceiptSBT
/// @notice Soul-bound (non-transferable) ERC-721 token minted at raffle settlement.
///         Stores the permanent on-chain record of winners, beneficiary, and pool size.
contract ReceiptSBT is ERC721, Ownable {
    using Strings for uint256;

    uint256 private _nextTokenId = 1;

    struct ReceiptData {
        address raffle;
        address[] winners;
        address winningBeneficiary;
        uint256 totalPool;
        uint256 settledAt;
    }

    mapping(uint256 => ReceiptData) private _receipts;
    mapping(address => bool) public authorizedMinters;

    event ReceiptMinted(uint256 indexed tokenId, address indexed raffle, uint256 totalPool);

    modifier onlyMinter() {
        require(authorizedMinters[msg.sender], "Not authorized minter");
        _;
    }

    constructor() ERC721("RaffleTime Receipt", "RTR") Ownable(msg.sender) {}

    function authorizeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = true;
    }

    function revokeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
    }

    /// @notice Mint a settlement receipt. Called by RaffleVault at SETTLED transition.
    function mint(
        address raffle,
        address[] calldata winners,
        address winningBeneficiary,
        uint256 totalPool
    ) external onlyMinter returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _mint(raffle, tokenId); // Minted to the vault itself as permanent record

        _receipts[tokenId] = ReceiptData({
            raffle: raffle,
            winners: winners,
            winningBeneficiary: winningBeneficiary,
            totalPool: totalPool,
            settledAt: block.timestamp
        });

        emit ReceiptMinted(tokenId, raffle, totalPool);
    }

    function getReceipt(uint256 tokenId) external view returns (ReceiptData memory) {
        require(tokenId > 0 && tokenId < _nextTokenId, "Invalid token ID");
        return _receipts[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId > 0 && tokenId < _nextTokenId, "Invalid token ID");
        ReceiptData memory receipt = _receipts[tokenId];

        string memory json = string(
            abi.encodePacked(
                '{"name":"RaffleTime Receipt #',
                tokenId.toString(),
                '","description":"Settlement receipt for a RaffleTime raffle","attributes":[{"trait_type":"Total Pool","value":"',
                receipt.totalPool.toString(),
                '"},{"trait_type":"Winners Count","value":"',
                receipt.winners.length.toString(),
                '"},{"trait_type":"Settled At","value":"',
                receipt.settledAt.toString(),
                '"}]}'
            )
        );

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    /// @notice Soul-bound: block all transfers except minting
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow minting (from == address(0)) but block all transfers
        require(from == address(0), "Soulbound: non-transferable");
        return super._update(to, tokenId, auth);
    }

    function totalReceipts() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
